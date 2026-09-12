// Subscription endpoints for Web Push: the companion app posts the
// PushSubscription object it gets back from
// registration.pushManager.subscribe(), and fetches the VAPID public key
// here rather than hardcoding it client-side, so a key rotation is a
// backend env change only.

import express, { Router } from "express";
import { getWebPushConfig } from "./config";
import { getPushSubscriptionStore } from "./subscriptionStore";

export const pushRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidSubscriptionBody(
  body: unknown,
): body is { endpoint: string; keys: { p256dh: string; auth: string } } {
  if (!isRecord(body) || typeof body.endpoint !== "string" || body.endpoint.length === 0) {
    return false;
  }
  const keys = body.keys;
  return (
    isRecord(keys) &&
    typeof keys.p256dh === "string" &&
    keys.p256dh.length > 0 &&
    typeof keys.auth === "string" &&
    keys.auth.length > 0
  );
}

pushRouter.get("/push/vapid-public-key", (_req, res) => {
  res.json({ publicKey: getWebPushConfig().publicKey });
});

pushRouter.post("/push/subscribe", express.json(), async (req, res, next) => {
  if (!isValidSubscriptionBody(req.body)) {
    res.status(400).json({ error: "Expected a PushSubscription JSON object with endpoint and keys.p256dh/auth" });
    return;
  }
  try {
    await getPushSubscriptionStore().save({
      endpoint: req.body.endpoint,
      p256dh: req.body.keys.p256dh,
      auth: req.body.keys.auth,
    });
    res.status(201).json({ status: "subscribed" });
  } catch (err) {
    next(err);
  }
});

pushRouter.delete("/push/subscribe", express.json(), async (req, res, next) => {
  const endpoint = isRecord(req.body) ? req.body.endpoint : undefined;
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    res.status(400).json({ error: "endpoint is required" });
    return;
  }
  try {
    await getPushSubscriptionStore().remove(endpoint);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
