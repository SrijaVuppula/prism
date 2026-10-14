// Simulated doorbell events, shared by the event simulator (`npm run seed`,
// scripts/seed-simulator-events.ts) and the companion app's "Send a test
// visitor" button (routes.ts). Each is a Ring v1.1 webhook payload with a
// `simulator` attribute real webhooks never carry: one of the labeled
// photos in eval/fixtures as the snapshot, and the label
// "Front Door (simulator)".

import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hourInTimeZone } from "../preferences/timeZone";

export const FIXTURES_DIR = path.resolve(__dirname, "..", "..", "eval", "fixtures");

/** The Ring webhook type and Smart Alerts sub_type for each kind of simulated event. */
export const RING_EVENT_TYPES = {
  ding: { type: "button_press" },
  motion: { type: "motion_detected", sub_type: "motion" },
  "person-detected": { type: "motion_detected", sub_type: "human" },
  "package-detected": { type: "motion_detected", sub_type: "package_delivery" },
} as const;

export interface SimulatedEvent {
  kind: keyof typeof RING_EVENT_TYPES;
  /** Fixture image (without .jpg) under eval/fixtures used as the snapshot. */
  fixture: string;
  label: string;
  /** Send with a late-night timestamp rather than the current time. */
  atNight?: boolean;
}

export const SAMPLE_EVENTS: SimulatedEvent[] = [
  { kind: "ding", fixture: "person-front-door-daylight", label: "doorbell press by a visitor" },
  { kind: "motion", fixture: "animal-cat-on-porch", label: "cat on the porch" },
  { kind: "package-detected", fixture: "package-doorstep-daylight", label: "package left at the door" },
  // Same snapshot as the first event, so repeat-visitor memory can match it
  // to that earlier visit.
  { kind: "ding", fixture: "person-front-door-daylight", label: "same visitor rings again" },
  { kind: "person-detected", fixture: "person-night-lowlight", label: "person at the door at night", atNight: true },
];

/**
 * A moment that is late at night in `timeZone`: now, if it already is
 * (22:00-05:59, the default off-hours window in prism-alert-engine's
 * scoring), otherwise the same minute at 11 PM the evening before.
 */
export function lateNight(now: Date, timeZone: string): Date {
  const hour = hourInTimeZone(now, timeZone);
  if (hour >= 22 || hour <= 5) return now;
  return new Date(now.getTime() - (hour + 1) * 3_600_000);
}

/**
 * The fixture photo as a URL the backend can read: a file:// URL, or under
 * SIMULATOR_SNAPSHOT_BASE_URL when set (for a backend on another machine).
 */
export function fixtureSnapshotUrl(fixture: string): string {
  const baseUrl = process.env.SIMULATOR_SNAPSHOT_BASE_URL;
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/${fixture}.jpg`;
  }
  return pathToFileURL(path.join(FIXTURES_DIR, `${fixture}.jpg`)).href;
}

/**
 * The webhook Ring would send for this event, from SIMULATOR_DEVICE_ID
 * (default "sim-device-1"). With Ring API access, SIMULATOR_DEVICE_ID can
 * name a real device on the account (see `npm run ring:devices`), and alerts
 * then show the name the Ring API gives it.
 */
export function buildSimulatedWebhook(sample: SimulatedEvent, occurredAt: Date) {
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
        simulator: { snapshot_url: fixtureSnapshotUrl(sample.fixture), device_name: "Front Door (simulator)" },
      },
      relationships: { devices: { links: { self: `/v1/devices/${deviceId}` } } },
    },
  };
}
