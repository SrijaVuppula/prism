// Replays a realistic sequence of Ring-shaped webhook events against a
// locally running prism-backend, so the webhook receiver -> normalization
// path can be exercised end to end without waiting on live Ring device
// activity.
//
// Usage (with the backend already running via `npm run dev:backend`):
//   RING_WEBHOOK_SECRET=<same value the backend is configured with> npm run seed

import { createHmac, randomUUID } from "node:crypto";

const TARGET_URL = process.env.SIMULATOR_TARGET_URL ?? "http://localhost:3000/webhooks/ring";
const WEBHOOK_SECRET = process.env.RING_WEBHOOK_SECRET;

interface SimulatedEvent {
  kind: "ding" | "motion" | "person-detected" | "package-detected";
}

const SAMPLE_EVENTS: SimulatedEvent[] = [
  { kind: "ding" },
  { kind: "motion" },
  { kind: "person-detected" },
  { kind: "package-detected" },
];

function buildPayload(sample: SimulatedEvent) {
  return {
    event_id: randomUUID(),
    kind: sample.kind,
    device: { id: "sim-device-1", description: "Front Door (simulator)" },
    created_at: new Date().toISOString(),
    snapshot_url: `https://example.com/simulator/${sample.kind}.jpg`,
  };
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function main() {
  if (!WEBHOOK_SECRET) {
    console.error("Set RING_WEBHOOK_SECRET to the same value the backend is configured with.");
    process.exitCode = 1;
    return;
  }

  for (const sample of SAMPLE_EVENTS) {
    const payload = buildPayload(sample);
    const body = JSON.stringify(payload);
    const signature = sign(body, WEBHOOK_SECRET);

    try {
      const response = await fetch(TARGET_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ring-Signature": signature,
        },
        body,
      });
      const text = await response.text();
      console.log(`[${response.ok ? "ok" : "failed"}] ${sample.kind} -> ${response.status} ${text}`);
    } catch (err) {
      console.error(`[error] ${sample.kind} ->`, err);
    }
  }
}

main();
