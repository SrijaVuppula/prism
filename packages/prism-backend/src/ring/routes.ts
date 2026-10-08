// Express routes for the Ring integration, matching the partner-hosted
// endpoints registered in the Ring Developer Portal:
//
// - Token Exchange URL  POST /ring/token-exchange  Ring sends an OAuth
//   authorization code after a user approves Prism; Prism exchanges it and
//   stores the tokens as unclaimed.
// - Account Link URL    GET/POST /ring/link        Ring then redirects the
//   user here with a signed nonce; after the household signs in, Prism
//   matches the nonce to the unclaimed tokens and confirms the link.
// - Webhook URL         POST /webhooks/ring        Signed event
//   notifications.

import express, { Router } from "express";
import { runPipeline } from "../bedrock/agentOrchestration";
import { getRingEventStore } from "../db/eventStore";
import { findAccountForNonce, linkTimeProblem, passcodeMatches } from "./accountLinking";
import { getRingLinkPasscode, getRingWebhookSecret } from "./config";
import { getRingDeviceDirectory } from "./deviceDirectory";
import { messagePage, signInPage } from "./linkPage";
import { exchangeCodeForTokens } from "./oauth";
import { RingClient } from "./ringClient";
import { getRingTokenStore } from "./tokenStore";
import {
  parseRingWebhook,
  toRingAlert,
  verifyHmacSignature,
  RingWebhookValidationError,
  type RingAlert,
  type RingWebhook,
} from "./webhookHandler";

export const ringRouter = Router();

function stringParam(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Ring POSTs the authorization code server-to-server; it has to be
 * exchanged within 60 seconds. The code is read from a JSON or form body,
 * or the query string.
 */
ringRouter.post(
  "/ring/token-exchange",
  express.json(),
  express.urlencoded({ extended: false }),
  async (req, res) => {
    const code = stringParam(req.body?.code) || stringParam(req.query.code);
    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens(code);
      const accountId = await new RingClient(tokens.accessToken).getAccountId();
      await getRingTokenStore().saveUnclaimed(accountId, tokens);
      console.log(`[ring] received tokens for account ${accountId}; waiting for the household to finish linking`);
      res.status(200).json({ status: "ok" });
    } catch (err) {
      console.error("[ring] token exchange failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ error: "Token exchange failed" });
    }
  },
);

ringRouter.get("/ring/link", (req, res) => {
  const nonce = stringParam(req.query.nonce);
  const time = stringParam(req.query.time);
  const problem = !nonce ? "The link is missing its nonce. Start again from the Ring app." : linkTimeProblem(time);
  if (problem) {
    res.status(400).type("html").send(messagePage("This link can't be used", problem, true));
    return;
  }
  if (!getRingLinkPasscode()) {
    res
      .status(503)
      .type("html")
      .send(messagePage("Linking isn't set up", "Set RING_LINK_PASSCODE in Prism's backend configuration, then start again from the Ring app.", true));
    return;
  }
  res.type("html").send(signInPage(nonce, time));
});

ringRouter.post("/ring/link", express.urlencoded({ extended: false }), async (req, res) => {
  const nonce = stringParam(req.body?.nonce);
  const time = stringParam(req.body?.time);
  const passcode = stringParam(req.body?.passcode);

  const problem = !nonce ? "The link is missing its nonce. Start again from the Ring app." : linkTimeProblem(time);
  if (problem) {
    res.status(400).type("html").send(messagePage("This link can't be used", problem, true));
    return;
  }
  const expectedPasscode = getRingLinkPasscode();
  if (!expectedPasscode || !passcodeMatches(passcode, expectedPasscode)) {
    res.status(401).type("html").send(signInPage(nonce, time, "That passcode isn't right. Try again."));
    return;
  }

  // Nonce matching only happens after sign-in, as Ring requires.
  try {
    const store = getRingTokenStore();
    const account = findAccountForNonce(nonce, time, await store.listUnclaimed(), getRingWebhookSecret());
    if (!account) {
      res
        .status(400)
        .type("html")
        .send(messagePage("Ring account not found", "Prism hasn't received this Ring account's authorization. Start again from the Ring app.", true));
      return;
    }
    const accessToken = await store.getValidAccessToken(account);
    await new RingClient(accessToken).completeAccountLink(nonce);
    await store.markLinked(account.accountId);
    getRingDeviceDirectory().invalidate();
    console.log(`[ring] linked account ${account.accountId}`);
    res.type("html").send(messagePage("Ring account linked", "Prism will now alert you about events from your Ring devices. You can close this page."));
  } catch (err) {
    console.error("[ring] account linking failed:", err instanceof Error ? err.message : err);
    res.status(502).type("html").send(messagePage("Linking didn't finish", "Ring couldn't confirm the link. Start again from the Ring app.", true));
  }
});

/** Bookkeeping for webhooks that don't produce an alert. */
async function handleLifecycleWebhook(webhook: RingWebhook): Promise<void> {
  switch (webhook.data.type) {
    case "app_integration_removed":
      // The user unlinked Prism in the Ring app; its tokens no longer work.
      await getRingTokenStore().delete(webhook.meta.account_id);
      getRingDeviceDirectory().invalidate();
      break;
    case "device_added":
    case "device_removed":
      getRingDeviceDirectory().invalidate();
      break;
  }
}

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
      try {
        await handleLifecycleWebhook(webhook);
      } catch (err) {
        next(err);
        return;
      }
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
