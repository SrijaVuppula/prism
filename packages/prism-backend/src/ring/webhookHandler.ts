// Webhook receiver support: HMAC signature verification and normalization
// of raw Ring webhook events into the internal PrismEvent schema.
//
// Signature verification must happen on the raw request body before it is
// parsed as JSON -- re-serializing a parsed object is not guaranteed to
// produce the exact bytes Ring signed. See routes.ts for how this is wired
// into the request pipeline.

import { createHmac, timingSafeEqual } from "node:crypto";
import { PrismEvent } from "prism-alert-engine";

export class RingWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RingWebhookValidationError";
  }
}

interface RingDeviceInfo {
  id: string;
  description: string;
}

interface RingEventBase {
  event_id: string;
  device: RingDeviceInfo;
  /** ISO 8601 timestamp. */
  created_at: string;
  snapshot_url: string;
}

export interface RingDingEvent extends RingEventBase {
  kind: "ding";
}

export interface RingMotionEvent extends RingEventBase {
  kind: "motion";
}

export interface RingPersonDetectedEvent extends RingEventBase {
  kind: "person-detected";
}

export interface RingPackageDetectedEvent extends RingEventBase {
  kind: "package-detected";
}

export type RawRingEvent =
  | RingDingEvent
  | RingMotionEvent
  | RingPersonDetectedEvent
  | RingPackageDetectedEvent;

const KNOWN_EVENT_KINDS = new Set(["ding", "motion", "person-detected", "package-detected"]);

/**
 * Verifies the HMAC-SHA256 signature Ring attaches to each webhook request.
 * `rawBody` must be the exact bytes received on the wire (before JSON
 * parsing) and `signatureHeader` may be a bare hex digest or a
 * `sha256=<hex>`-prefixed one.
 */
export function verifyHmacSignature(
  rawBody: Buffer | string,
  signatureHeader: string,
  secret: string,
): boolean {
  const providedHex = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");

  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Runtime validation of an already-JSON-parsed webhook body. Throws RingWebhookValidationError on any mismatch. */
export function assertRawRingEvent(value: unknown): asserts value is RawRingEvent {
  if (!isRecord(value)) {
    throw new RingWebhookValidationError("Webhook body is not a JSON object");
  }
  if (typeof value.kind !== "string" || !KNOWN_EVENT_KINDS.has(value.kind)) {
    throw new RingWebhookValidationError(`Unknown or missing event kind: ${String(value.kind)}`);
  }
  if (typeof value.event_id !== "string" || value.event_id.length === 0) {
    throw new RingWebhookValidationError("Missing event_id");
  }
  if (typeof value.created_at !== "string" || Number.isNaN(Date.parse(value.created_at))) {
    throw new RingWebhookValidationError(`Missing or invalid created_at: ${String(value.created_at)}`);
  }
  if (typeof value.snapshot_url !== "string" || value.snapshot_url.length === 0) {
    throw new RingWebhookValidationError("Missing snapshot_url");
  }
  if (!isRecord(value.device) || typeof value.device.id !== "string") {
    throw new RingWebhookValidationError("Missing device.id");
  }
}

/** Maps a validated raw Ring webhook event onto the shared PrismEvent shape. */
export function normalizeRingEvent(raw: unknown): PrismEvent {
  assertRawRingEvent(raw);
  return {
    id: raw.event_id,
    occurredAt: new Date(raw.created_at).toISOString(),
    snapshotUrl: raw.snapshot_url,
  };
}
