// Replays a realistic sequence of Ring-shaped webhook events against a
// locally running prism-backend, so the full pipeline -- webhook receiver,
// Bedrock classification, Signal Score, and delivery to the companion app --
// can be exercised end to end without waiting on live Ring device activity.
//
// Each event's snapshot is one of the labeled photos in
// packages/prism-backend/eval/fixtures, sent as a file:// URL that the
// backend reads directly (the same way the eval harness does). That only
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

import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../packages/prism-backend/src/loadEnv";

const FIXTURES_DIR = path.resolve(__dirname, "..", "packages", "prism-backend", "eval", "fixtures");
const DEFAULT_DELAY_MS = 4000;

interface SimulatedEvent {
  kind: "ding" | "motion" | "person-detected" | "package-detected";
  /** Fixture image (without .jpg) under eval/fixtures used as the snapshot. */
  fixture: string;
  label: string;
}

const SAMPLE_EVENTS: SimulatedEvent[] = [
  { kind: "ding", fixture: "person-front-door-daylight", label: "doorbell press by a visitor" },
  { kind: "motion", fixture: "animal-cat-on-porch", label: "cat on the porch" },
  { kind: "package-detected", fixture: "package-doorstep-daylight", label: "package left at the door" },
  { kind: "person-detected", fixture: "person-night-lowlight", label: "person at the door at night" },
  // Same snapshot as the first event, so repeat-visitor memory can match it
  // to that earlier visit.
  { kind: "ding", fixture: "person-front-door-daylight", label: "same visitor rings again" },
];

function snapshotUrl(fixture: string): string {
  const baseUrl = process.env.SIMULATOR_SNAPSHOT_BASE_URL;
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/${fixture}.jpg`;
  }
  return pathToFileURL(path.join(FIXTURES_DIR, `${fixture}.jpg`)).href;
}

function buildPayload(sample: SimulatedEvent) {
  return {
    event_id: randomUUID(),
    kind: sample.kind,
    device: { id: "sim-device-1", description: "Front Door (simulator)" },
    created_at: new Date().toISOString(),
    snapshot_url: snapshotUrl(sample.fixture),
  };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
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

  for (const [index, sample] of SAMPLE_EVENTS.entries()) {
    // Spaced out so each alert arrives on its own, and so the repeat visit
    // at the end is processed after the first visit has been remembered.
    if (index > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const payload = buildPayload(sample);
    const body = JSON.stringify(payload);
    const signature = sign(body, webhookSecret);

    try {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ring-Signature": signature,
        },
        body,
      });
      const text = await response.text();
      console.log(`[${response.ok ? "ok" : "failed"}] ${sample.kind} (${sample.label}) -> ${response.status} ${text}`);
    } catch (err) {
      console.error(`[error] ${sample.kind} (${sample.label}) ->`, err);
    }
  }
}

main();
