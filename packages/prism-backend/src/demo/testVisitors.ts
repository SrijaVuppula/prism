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
  /** For motion events: the Smart Alerts sub_type to send instead of plain "motion". */
  motionSubType?: "vehicle";
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
 * What "Send a test visitor" cycles through: the five sample events first,
 * so the first presses show a repeat visit and then an Urgent night-time
 * visitor, then a wider mix of people, packages, vehicles and animals, by
 * day and at night, from the rest of the labeled photos.
 */
export const TEST_VISITORS: SimulatedEvent[] = [
  ...SAMPLE_EVENTS,
  { kind: "ding", fixture: "person-delivery-holding-box", label: "delivery driver ringing with a box" },
  { kind: "motion", motionSubType: "vehicle", fixture: "vehicle-delivery-truck", label: "delivery truck out front" },
  { kind: "motion", fixture: "animal-deer-in-yard", label: "deer in the yard" },
  { kind: "package-detected", fixture: "package-multiple-stacked", label: "stack of packages" },
  { kind: "person-detected", fixture: "person-group-of-two", label: "two people at the door" },
  { kind: "motion", fixture: "animal-raccoon-night", label: "raccoon at night", atNight: true },
  { kind: "motion", motionSubType: "vehicle", fixture: "vehicle-car-parked-driveway", label: "car parked in the driveway" },
  { kind: "package-detected", fixture: "package-small-envelope", label: "envelope left at the door" },
  { kind: "person-detected", fixture: "person-heavy-rain", label: "person in heavy rain" },
  { kind: "motion", motionSubType: "vehicle", fixture: "vehicle-night-headlights", label: "car headlights at night", atNight: true },
  { kind: "motion", fixture: "animal-dog-walking-by", label: "dog on the porch" },
  { kind: "package-detected", fixture: "package-doorstep-night-flash", label: "package left at night", atNight: true },
  { kind: "person-detected", fixture: "person-walking-away", label: "person walking past on the street" },
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
  const { type, ...eventSubType } = RING_EVENT_TYPES[sample.kind];
  const subType = sample.motionSubType ? { sub_type: sample.motionSubType } : eventSubType;
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
