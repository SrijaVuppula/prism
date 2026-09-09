// Webhook receiver + normalization into the internal PrismEvent schema.
// TODO: verify the HMAC signature on every inbound event BEFORE trusting
// the payload. Never process an unverified event.

import { PrismEvent } from "prism-alert-engine";

export interface RawRingEvent {
  // TODO: fill in the actual payload shape once confirmed against the
  // Ring sandbox/simulator.
  [key: string]: unknown;
}

export function verifyHmacSignature(_payload: unknown, _signature: string): boolean {
  throw new Error("TODO: implement HMAC verification");
}

export function normalizeRingEvent(_raw: RawRingEvent): PrismEvent {
  throw new Error("TODO: map raw Ring event -> normalized PrismEvent");
}
