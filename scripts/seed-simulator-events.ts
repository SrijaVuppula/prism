// Replays a realistic sequence of Ring webhook events against a locally
// running prism-backend, so the full pipeline - webhook receiver, Bedrock
// classification, Signal Score, and delivery to the companion app - can be
// exercised end to end without waiting on live Ring device activity.
//
// Each event is a Ring v1.1 webhook (button_press, or motion_detected with
// a Smart Alerts sub_type), signed the way Ring signs them: an HMAC-SHA256
// of the body, keyed with RING_WEBHOOK_SECRET, in the X-Signature header.
// Real Ring webhooks carry no image, so each one adds a `simulator`
// attribute with a snapshot - one of the labeled photos in
// packages/prism-backend/eval/fixtures, as a file:// URL the backend reads
// directly - and the label "Front Door (simulator)". The events themselves
// are in packages/prism-backend/src/demo/testVisitors.ts, shared with the
// companion app's "Send a test visitor" button. A file:// URL only works
// when the backend runs on this machine; for a backend elsewhere, set
// SIMULATOR_SNAPSHOT_BASE_URL to a URL prefix the backend can fetch the
// fixture images from.
//
// Usage (with the backend already running via `npm run dev`):
//   npm run seed
//
// RING_WEBHOOK_SECRET is read from the environment or, like the backend
// itself, from packages/prism-backend/.env, so both sides sign and verify
// with the same secret. SIMULATOR_DELAY_MS sets the pause between events.
//
// With RING_ACCESS_TOKEN set on the backend, SIMULATOR_DEVICE_ID can name a
// real device on that Ring account instead (see `npm run ring:devices`), and
// the alerts then show the name the Ring API gives it.
//
// The night-time snapshot is sent with a late-night timestamp in the
// household's time zone (read from the backend's preferences), so it gets
// the Signal Score's late-night factor whatever time the simulator is run.

import { createHmac } from "node:crypto";
import { buildSimulatedWebhook, lateNight, SAMPLE_EVENTS } from "../packages/prism-backend/src/demo/testVisitors";
import { loadEnv } from "../packages/prism-backend/src/loadEnv";
import { DEFAULT_TIME_ZONE } from "../packages/prism-backend/src/preferences/timeZone";

const DEFAULT_DELAY_MS = 4000;

/** The household's time zone from the backend's preferences, or UTC if unavailable. */
async function householdTimeZone(targetUrl: string): Promise<string> {
  try {
    const response = await fetch(new URL("/preferences", targetUrl));
    if (response.ok) {
      const preferences = (await response.json()) as { timeZone?: unknown };
      if (typeof preferences.timeZone === "string") return preferences.timeZone;
    }
  } catch {
    // Fall through to UTC.
  }
  return DEFAULT_TIME_ZONE;
}

function describeTime(date: Date, timeZone: string): string {
  return date.toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function main() {
  loadEnv();
  const targetUrl = process.env.SIMULATOR_TARGET_URL ?? "http://localhost:3000/webhooks/ring";
  const webhookSecret = process.env.RING_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Set RING_WEBHOOK_SECRET to the same value the backend is configured with.");
    process.exitCode = 1;
    return;
  }
  const delayMs = Number(process.env.SIMULATOR_DELAY_MS ?? DEFAULT_DELAY_MS);
  const timeZone = await householdTimeZone(targetUrl);

  for (const [index, sample] of SAMPLE_EVENTS.entries()) {
    // Spaced out so each alert arrives on its own, and so the repeat visit
    // is processed after the first visit has been remembered.
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const now = new Date();
    const occurredAt = sample.atNight ? lateNight(now, timeZone) : now;
    const label = occurredAt === now ? sample.label : `${sample.label}, ${describeTime(occurredAt, timeZone)}`;
    const payload = buildSimulatedWebhook(sample, occurredAt);
    const body = JSON.stringify(payload);
    const signature = sign(body, webhookSecret);

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
        },
        body,
      });
      const text = await response.text();
      console.log(`[${response.ok ? "ok" : "failed"}] ${sample.kind} (${label}) -> ${response.status} ${text}`);
    } catch (err) {
      console.error(`[error] ${sample.kind} (${label}) ->`, err);
    }
  }
}

main();
