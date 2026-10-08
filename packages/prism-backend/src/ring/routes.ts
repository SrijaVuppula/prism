// Express routes for the Ring integration: account-link kickoff/callback and
// the webhook receiver.

import { randomUUID } from "node:crypto";
import express, { Router } from "express";
import {
  buildAccountLinkUrl,
  exchangeCodeForTokens,
  RingAlreadyLinkedError,
  RingOAuthError,
} from "./oauth";
import { getRingWebhookSecret } from "./config";
import { getRingTokenStore } from "./tokenStore";
import {
  parseRingWebhook,
  toRingAlert,
  verifyHmacSignature,
  RingWebhookValidationError,
  type RingAlert,
  type RingWebhook,
} from "./webhookHandler";
import { getRingEventStore } from "../db/eventStore";
import { runPipeline } from "../bedrock/agentOrchestration";

export const ringRouter = Router();

// Maps an OAuth `state` value to the Prism user id that started the link, so
// the callback can attribute the tokens to the right account. In-memory and
// per-process: fine for a single backend instance, but move it to Postgres
// (alongside ring_accounts) before running more than one instance.
const pendingLinkStates = new Map<string, string>();

ringRouter.get("/auth/ring/link", (req, res) => {
  // TODO: read the user id from the authenticated session once auth exists;
  // a query param is a placeholder.
  const userId = req.query.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const state = randomUUID();
  pendingLinkStates.set(state, userId);
  res.redirect(buildAccountLinkUrl(state));
});

ringRouter.get("/auth/ring/callback", async (req, res, next) => {
  const { code, state } = req.query;
  if (typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  const userId = pendingLinkStates.get(state);
  if (!userId) {
    res.status(400).json({ error: "Unknown or expired link state" });
    return;
  }
  pendingLinkStates.delete(state);

  try {
    const tokens = await exchangeCodeForTokens(code);
    await getRingTokenStore().save(userId, tokens);
    res.json({ status: "linked" });
  } catch (err) {
    if (err instanceof RingAlreadyLinkedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof RingOAuthError) {
      res.status(502).json({ error: err.message });
      return;
    }
    next(err);
  }
});

ringRouter.delete("/auth/ring/link", async (req, res) => {
  const userId = req.query.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  await getRingTokenStore().delete(userId);
  res.status(204).end();
});

ringRouter.post(
  "/webhooks/ring",
  // Raw body is required here (and only here) so the HMAC signature can be
  // verified against the exact bytes Ring sent.
  express.raw({ type: "application/json" }),
  async (req, res, next) => {
    const signature = req.header("X-Signature");
    if (!signature) {
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const rawBody = req.body as Buffer;
    let webhookSecret: string;
    try {
      webhookSecret = getRingWebhookSecret();
    } catch (err) {
      // Express 4 doesn't catch errors thrown from async handlers; without
      // this a missing secret would leave the request hanging.
      next(err);
      return;
    }
    if (!verifyHmacSignature(rawBody, signature, webhookSecret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Ring treats a 4xx as permanent (no retry) and a 5xx as temporary, so
    // malformed payloads get a 400 and storage failures a 500.
    let alert: RingAlert | null;
    let webhook: RingWebhook;
    try {
      webhook = parseRingWebhook(JSON.parse(rawBody.toString("utf8")));
      alert = toRingAlert(webhook);
    } catch (err) {
      const message = err instanceof RingWebhookValidationError ? err.message : "Malformed JSON";
      res.status(400).json({ error: message });
      return;
    }

    if (!alert) {
      console.log(`[ring] webhook ${webhook.data.type} for account ${webhook.meta.account_id} received; no alert needed`);
      res.status(200).json({ status: "received", type: webhook.data.type });
      return;
    }

    let stored: boolean;
    try {
      stored = await getRingEventStore().save(alert.event, alert.kind, webhook);
    } catch (err) {
      next(err);
      return;
    }
    if (!stored) {
      // A redelivery of an event already being handled.
      res.status(200).json({ status: "duplicate", eventId: alert.event.id });
      return;
    }
    res.status(200).json({ status: "accepted", eventId: alert.event.id });

    // Runs after the response, since Ring expects one within 5 seconds and
    // classification takes longer. Errors are logged rather than surfaced
    // to Ring, which has no way to act on them and would otherwise retry a
    // webhook that was already accepted and stored.
    const { event, deviceName, fallbackClassification } = alert;
    runPipeline(event, undefined, { deviceName, fallbackClassification }).catch((err) => {
      console.error(`[orchestration] pipeline failed for event ${event.id}:`, err);
    });
  },
);
