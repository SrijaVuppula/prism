// POST /test-visitor: the companion app's "Send a test visitor" button.
// Each press sends the next simulated event from testVisitors.ts (a
// doorbell press, a cat, a package, the first visitor again, a night-time
// visit) through the same path as a Ring webhook, so someone trying Prism
// can feel each kind of alert without a terminal. TEST_VISITOR=off turns
// it off.

import { Router } from "express";
import { DEFAULT_PREFERENCES, getPreferencesStore } from "../preferences/preferencesStore";
import { startAlert } from "../ring/routes";
import { parseRingWebhook, toRingAlert } from "../ring/webhookHandler";
import { buildSimulatedWebhook, lateNight, SAMPLE_EVENTS } from "./testVisitors";

export const demoRouter = Router();

/** Presses closer together than this are refused, so a double tap sends one visitor. */
const MIN_INTERVAL_MS = 3_000;

let nextSample = 0;
let lastSentAt = 0;

/** Starts the sequence over, for tests. */
export function resetTestVisitors(): void {
  nextSample = 0;
  lastSentAt = 0;
}

async function householdTimeZone(): Promise<string> {
  try {
    return (await getPreferencesStore().get()).timeZone;
  } catch {
    return DEFAULT_PREFERENCES.timeZone;
  }
}

demoRouter.post("/test-visitor", async (_req, res, next) => {
  if (process.env.TEST_VISITOR === "off") {
    res.status(404).json({ error: "Test visitors are turned off on this server." });
    return;
  }
  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS) {
    res.status(429).json({ error: "One test visitor at a time. Try again in a few seconds." });
    return;
  }
  lastSentAt = now;

  const sample = SAMPLE_EVENTS[nextSample % SAMPLE_EVENTS.length];
  nextSample += 1;
  try {
    const occurredAt = sample.atNight ? lateNight(new Date(now), await householdTimeZone()) : new Date(now);
    const webhook = parseRingWebhook(buildSimulatedWebhook(sample, occurredAt));
    const alert = toRingAlert(webhook)!;
    await startAlert(alert, webhook);
    console.log(`[test-visitor] sent: ${sample.label}`);
    res.status(202).json({ status: "sent", label: sample.label, eventId: alert.event.id });
  } catch (err) {
    next(err);
  }
});
