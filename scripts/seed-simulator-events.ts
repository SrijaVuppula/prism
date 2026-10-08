// Replays a realistic sequence of Ring webhook events against a locally
// running prism-backend, so the full pipeline -- webhook receiver, Bedrock
// classification, Signal Score, and delivery to the companion app -- can be
// exercised end to end without waiting on live Ring device activity.
//
// Each event is a Ring v1.1 webhook (button_press, or motion_detected with
// a Smart Alerts sub_type), signed the way Ring signs them: an HMAC-SHA256
// of the body, keyed with RING_WEBHOOK_SECRET, in the X-Signature header.
// Real Ring webhooks carry no image, so each one adds a `simulator`
// attribute with a snapshot -- one of the labeled photos in
// packages/prism-backend/eval/fixtures, as a file:// URL the backend reads
// directly -- and the label "Front Door (simulator)". A file:// URL only
// works when the backend runs on this machine; for a backend elsewhere, set
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

import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../packages/prism-backend/src/loadEnv";
import { DEFAULT_TIME_ZONE, hourInTimeZone } from "../packages/prism-backend/src/preferences/timeZone";

const FIXTURES_DIR = path.resolve(__dirname, "..", "packages", "prism-backend", "eval", "fixtures");
const DEFAULT_DELAY_MS = 4000;

/** The Ring webhook type and Smart Alerts sub_type for each kind of simulated event. */
const RING_EVENT_TYPES = {
  ding: { type: "button_press" },
  motion: { type: "motion_detected", sub_type: "motion" },
  "person-detected": { type: "motion_detected", sub_type: "human" },
  "package-detected": { type: "motion_detected", sub_type: "package_delivery" },
} as const;

interface SimulatedEvent {
  kind: keyof typeof RING_EVENT_TYPES;
  /** Fixture image (without .jpg) under eval/fixtures used as the snapshot. */
  fixture: string;
  label: string;
  /** Send with a late-night timestamp rather than the current time. */
  atNight?: boolean;
}

const SAMPLE_EVENTS: SimulatedEvent[] = [
  { kind: "ding", fixture: "person-front-door-daylight", label: "doorbell press by a visitor" },
  { kind: "motion", fixture: "animal-cat-on-porch", label: "cat on the porch" },
  { kind: "package-detected", fixture: "package-doorstep-daylight", label: "package left at the door" },
  // Same snapshot as the first event, so repeat-visitor memory can match it
  // to that earlier visit.
  { kind: "ding", fixture: "person-front-door-daylight", label: "same visitor rings again" },
  { kind: "person-detected", fixture: "person-night-lowlight", label: "person at the door at night", atNight: true },
];

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

/**
 * A moment that is late at night in `timeZone`: now, if it already is
 * (22:00-05:59, the default off-hours window in prism-alert-engine's
 * scoring), otherwise the same minute at 11 PM the evening before.
 */
function lateNight(now: Date, timeZone: string): Date {
  const hour = hourInTimeZone(now, timeZone);
  if (hour >= 22 || hour <= 5) return now;
  return new Date(now.getTime() - (hour + 1) * 3_600_000);
}

function describeTime(date: Date, timeZone: string): string {
  return date.toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function snapshotUrl(fixture: string): string {
  const baseUrl = process.env.SIMULATOR_SNAPSHOT_BASE_URL;
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/${fixture}.jpg`;
  }
  return pathToFileURL(path.join(FIXTURES_DIR, `${fixture}.jpg`)).href;
}

function buildPayload(sample: SimulatedEvent, occurredAt: Date) {
  const deviceId = process.env.SIMULATOR_DEVICE_ID || "sim-device-1";
  const { type, ...subType } = RING_EVENT_TYPES[sample.kind];
  const timestamp = occurredAt.getTime();
  return {
    meta: { version: "1.1", time: new Date().toISOString(), request_id: randomUUID(), account_id: "sim-account" },
    data: {
      id: `${deviceId}_${type}_${timestamp}`,
      type,
      attributes: {
        source: deviceId,
        source_type: "devices",
        timestamp,
        ...subType,
        simulator: { snapshot_url: snapshotUrl(sample.fixture), device_name: "Front Door (simulator)" },
      },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
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
    const payload = buildPayload(sample, occurredAt);
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
