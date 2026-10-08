// Webhook receiver support: HMAC signature verification, validation of
// Ring's v1.1 webhook payload, and mapping of the events Prism alerts on
// into the internal PrismEvent schema. Follows the Notifications section of
// Ring's Partner API documentation.
//
// Signature verification must happen on the raw request body before it is
// parsed as JSON -- re-serializing a parsed object is not guaranteed to
// produce the exact bytes Ring signed. See routes.ts for how this is wired
// into the request pipeline.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClassificationResult, PrismEvent } from "prism-alert-engine";
import { ringSnapshotUrl } from "./snapshots";

export class RingWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RingWebhookValidationError";
  }
}

/**
 * Fields the event simulator (scripts/seed-simulator-events.ts) adds to the
 * attributes of an otherwise Ring-format webhook. Real Ring webhooks never
 * carry them: they have no image and no device name, which Prism gets from
 * the Ring API instead.
 */
export interface SimulatorAttributes {
  /** Snapshot to classify, e.g. a file:// URL of a labeled fixture photo. */
  snapshot_url?: string;
  /** Label for the simulated device, e.g. "Front Door (simulator)". */
  device_name?: string;
}

export interface RingWebhookAttributes {
  /** Device id for device events. */
  source?: string;
  source_type?: string;
  /** Epoch milliseconds when the event happened. */
  timestamp?: number;
  /** For motion_detected: motion, human, vehicle, package_delivery, other_motion (open-ended). */
  sub_type?: string;
  /** Camera modules that contributed, on multi-camera devices. */
  component_ids?: string[];
  simulator?: SimulatorAttributes;
  [key: string]: unknown;
}

/** A Ring v1.1 webhook. */
export interface RingWebhook {
  meta: {
    version: string;
    time: string;
    /** Unique per delivery; Ring may deliver an event more than once. */
    request_id: string;
    /** The Ring account the event belongs to. */
    account_id: string;
  };
  data: {
    id: string;
    type: string;
    attributes: RingWebhookAttributes;
  };
}

/** How Prism records the event that triggered an alert. */
export type RingAlertKind = "ding" | "motion" | "person-detected" | "package-detected";

export interface RingAlert {
  kind: RingAlertKind;
  event: PrismEvent;
  /** The simulator's device label; real events get their name from the Ring API. */
  deviceName?: string;
  /**
   * What Ring itself detected, used if the snapshot can't be downloaded or
   * classified, so a doorbell press still produces an alert.
   */
  fallbackClassification?: ClassificationResult;
}

/**
 * Verifies the `X-Signature` header Ring attaches to each webhook: an
 * HMAC-SHA256 of the raw body, keyed with the app's HMAC signing key (its
 * UTF-8 bytes), hex-encoded and prefixed with `sha256=`. A bare hex digest
 * is accepted too.
 */
export function verifyHmacSignature(rawBody: Buffer | string, signatureHeader: string, secret: string): boolean {
  const providedHex = signatureHeader.startsWith("sha256=") ? signatureHeader.slice("sha256=".length) : signatureHeader;
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return false;
  }

  const provided = Buffer.from(providedHex, "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RingWebhookValidationError(`Missing ${field}`);
  }
  return value;
}

/** Validates an already-JSON-parsed webhook body. Throws RingWebhookValidationError on any mismatch. */
export function parseRingWebhook(value: unknown): RingWebhook {
  if (!isRecord(value) || !isRecord(value.meta) || !isRecord(value.data)) {
    throw new RingWebhookValidationError("Webhook body is not a Ring v1.1 payload with meta and data");
  }
  const { meta, data } = value;
  const attributes = isRecord(data.attributes) ? data.attributes : {};
  return {
    meta: {
      version: typeof meta.version === "string" ? meta.version : "",
      time: typeof meta.time === "string" ? meta.time : "",
      request_id: requireString(meta.request_id, "meta.request_id"),
      account_id: requireString(meta.account_id, "meta.account_id"),
    },
    data: {
      id: requireString(data.id, "data.id"),
      type: requireString(data.type, "data.type"),
      attributes,
    },
  };
}

/** Ring's motion sub_type, which is only set when Smart Alerts is on for the device. */
function motionKind(subType: unknown): RingAlertKind {
  if (subType === "human") return "person-detected";
  if (subType === "package_delivery") return "package-detected";
  return "motion";
}

const NO_SNAPSHOT = "No snapshot was available to describe";

function fallbackClassification(kind: RingAlertKind, subType: unknown): ClassificationResult | undefined {
  switch (kind) {
    case "ding":
      return { category: "person", description: `Someone pressed the doorbell. ${NO_SNAPSHOT} them.`, confidence: 0.5 };
    case "person-detected":
      return { category: "person", description: `Ring detected a person. ${NO_SNAPSHOT} them.`, confidence: 0.5 };
    case "package-detected":
      return { category: "package", description: `Ring detected a package delivery. ${NO_SNAPSHOT} it.`, confidence: 0.5 };
    default:
      return subType === "vehicle"
        ? { category: "vehicle", description: `Ring detected a vehicle. ${NO_SNAPSHOT} it.`, confidence: 0.5 }
        : undefined;
  }
}

/**
 * The alert a webhook calls for, or null for events Prism doesn't alert on
 * (device added/removed/online/offline, integration and subscription
 * changes, and any event type Ring adds later).
 */
export function toRingAlert(webhook: RingWebhook): RingAlert | null {
  const { type, attributes } = webhook.data;
  let kind: RingAlertKind;
  if (type === "button_press") kind = "ding";
  else if (type === "motion_detected") kind = motionKind(attributes.sub_type);
  else return null;

  const deviceId = requireString(attributes.source, "data.attributes.source");
  const timestamp = attributes.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) {
    throw new RingWebhookValidationError(`Missing or invalid data.attributes.timestamp: ${String(timestamp)}`);
  }

  const simulator = isRecord(attributes.simulator) ? (attributes.simulator as SimulatorAttributes) : undefined;
  const componentId = Array.isArray(attributes.component_ids) ? attributes.component_ids[0] : undefined;
  const snapshotUrl =
    typeof simulator?.snapshot_url === "string" && simulator.snapshot_url
      ? simulator.snapshot_url
      : ringSnapshotUrl({
          deviceId,
          timestamp,
          accountId: webhook.meta.account_id,
          ...(typeof componentId === "string" ? { componentId } : {}),
        });

  const fallback = fallbackClassification(kind, attributes.sub_type);
  return {
    kind,
    event: {
      id: webhook.data.id,
      occurredAt: new Date(timestamp).toISOString(),
      snapshotUrl,
      // Populated so repeat-visitor session memory (db/vectorStore.ts) can
      // scope its rolling window to this specific device rather than mixing
      // events from every Ring device on the account into one session.
      deviceId,
    },
    ...(typeof simulator?.device_name === "string" && simulator.device_name ? { deviceName: simulator.device_name } : {}),
    ...(fallback ? { fallbackClassification: fallback } : {}),
  };
}
