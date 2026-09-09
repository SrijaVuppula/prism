// Webhook receiver + normalization into the internal PrismEvent schema.
// TODO (Phase 1.2): verify the HMAC signature on every inbound event
// BEFORE trusting the payload. Never process an unverified event.

import { PrismEvent } from "prism-alert-engine";

export interface RawRingEvent {
  // TODO: fill in from Spike 1 (Phase 0.2) — the actual observed payload shape.
  [key: string]: unknown;
}

export function verifyHmacSignature(_payload: unknown, _signature: string): boolean {
  throw new Error("TODO: implement HMAC verification (Phase 1.2)");
}

export function normalizeRingEvent(_raw: RawRingEvent): PrismEvent {
  throw new Error("TODO: map raw Ring event -> normalized PrismEvent (Phase 1.2)");
}
