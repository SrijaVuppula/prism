// End-to-end scenario tests for the full alert pipeline: a real signed HTTP
// webhook request all the way through normalization, classification,
// scoring, channel decision, and delivery -- not runPipeline() called
// directly (agentOrchestration.test.ts already exercises that in
// isolation), and not the webhook route with runPipeline stubbed out
// (routes.test.ts already exercises that). This file is the one place both
// halves run together, so a wiring mistake between them (e.g. the wrong
// field name crossing the toRingAlert -> runPipeline boundary)
// would actually be caught.
//
// Only the true external I/O boundaries are mocked -- Bedrock
// classification, Postgres-backed preferences/repeat-visitor-memory/
// feedback weights, WebSocket broadcast, and Web Push -- exactly the same
// boundary agentOrchestration.test.ts mocks. Everything in between
// (parseRingWebhook/toRingAlert, computeSignalScore, decideChannels, buildContextCard/
// buildPushPayload/encodeHapticPattern) is the real production code.
//
// The scenarios cover the shapes of event Prism actually has to get right
// for a deaf/hard-of-hearing user to trust it: a package delivery, an
// unknown visitor at night (should escalate), a known repeat visitor at
// night (should de-escalate despite otherwise-identical off-hours timing),
// a false-positive motion trigger (should stay calm, not buzz an urgent
// alert for a shadow), and a doorbell press whose snapshot can't be
// classified (should still alert). Webhooks use Ring's v1.1 format and
// X-Signature header, with the simulator's snapshot attribute standing in
// for the Ring API image download.

import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bedrock/multimodalContext", () => ({
  classifySnapshot: vi.fn(),
}));
vi.mock("../../src/api/websocket", () => ({
  broadcastEvent: vi.fn(),
}));
vi.mock("../../src/push/dispatchPush", () => ({
  dispatchPushNotifications: vi.fn(),
}));
vi.mock("../../src/preferences/preferencesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/preferences/preferencesStore")>();
  return { ...actual, getPreferencesStore: vi.fn() };
});
vi.mock("../../src/feedback/weightAdjustment", () => ({
  resolveSignalScoreWeights: vi.fn(),
}));
vi.mock("../../src/bedrock/repeatVisitorMemory", () => ({
  resolveRepeatVisitor: vi.fn(),
}));
vi.mock("../../src/db/eventStore", () => ({
  getRingEventStore: vi.fn(),
}));

import { classifySnapshot } from "../../src/bedrock/multimodalContext";
import { broadcastEvent } from "../../src/api/websocket";
import { dispatchPushNotifications } from "../../src/push/dispatchPush";
import { getPreferencesStore, DEFAULT_PREFERENCES } from "../../src/preferences/preferencesStore";
import { resolveSignalScoreWeights } from "../../src/feedback/weightAdjustment";
import { resolveRepeatVisitor } from "../../src/bedrock/repeatVisitorMemory";
import { getRingEventStore } from "../../src/db/eventStore";
import { DEFAULT_SIGNAL_SCORE_WEIGHTS } from "prism-alert-engine";
import { ringRouter } from "../../src/ring/routes";

const ENV = {
  RING_WEBHOOK_SECRET: "webhook-secret",
};

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const RING_EVENT_TYPES = {
  ding: { type: "button_press" },
  motion: { type: "motion_detected", sub_type: "motion" },
  "person-detected": { type: "motion_detected", sub_type: "human" },
  "package-detected": { type: "motion_detected", sub_type: "package_delivery" },
} as const;

interface RawEventInput {
  eventId: string;
  kind: "ding" | "motion" | "person-detected" | "package-detected";
  deviceId: string;
  createdAt: string;
  snapshotUrl: string;
}

async function postWebhook(baseUrl: string, input: RawEventInput) {
  const { type, ...subType } = RING_EVENT_TYPES[input.kind];
  const payload = {
    meta: { version: "1.1", time: input.createdAt, request_id: `req_${input.eventId}`, account_id: "acct_1" },
    data: {
      id: input.eventId,
      type,
      attributes: {
        source: input.deviceId,
        source_type: "devices",
        timestamp: Date.parse(input.createdAt),
        ...subType,
        simulator: { snapshot_url: input.snapshotUrl, device_name: "Front Door" },
      },
    },
  };
  const body = JSON.stringify(payload);
  return fetch(`${baseUrl}/webhooks/ring`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": sign(body, ENV.RING_WEBHOOK_SECRET) },
    body,
  });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(ringRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
  vi.mocked(classifySnapshot).mockReset();
  vi.mocked(broadcastEvent).mockReset();
  vi.mocked(dispatchPushNotifications).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPreferencesStore).mockReset().mockReturnValue({
    get: vi.fn().mockResolvedValue(DEFAULT_PREFERENCES),
    save: vi.fn(),
  } as never);
  vi.mocked(resolveSignalScoreWeights).mockReset().mockResolvedValue(DEFAULT_SIGNAL_SCORE_WEIGHTS);
  vi.mocked(resolveRepeatVisitor)
    .mockReset()
    .mockResolvedValue({ repeatVisitCount: 0, isKnownVisitor: false, visitorGroupId: "group_1" });
  vi.mocked(getRingEventStore).mockReset().mockReturnValue({
    save: vi.fn().mockResolvedValue(true),
    get: vi.fn(),
  } as never);
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
});

describe("full alert pipeline: webhook -> classify -> score -> deliver", () => {
  it("package delivery: scores Notable and buzzes haptic without an urgent push", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "package",
      description: "A package on the doorstep.",
      confidence: 0.92,
    });

    const response = await postWebhook(baseUrl, {
      eventId: "evt_package_1",
      kind: "package-detected",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T14:00:00.000Z", // daytime
      snapshotUrl: "https://cdn.ring.com/snap/evt_package_1.jpg",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted", eventId: "evt_package_1" });

    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));

    const [message] = vi.mocked(broadcastEvent).mock.calls[0];
    expect(message.event.classification?.category).toBe("package");
    expect(message.event.scoring?.signalClass).toBe("Notable");
    expect(message.channels.visual?.description).toBe("A package on the doorstep.");
    expect(message.channels.haptic).toBeDefined();
    expect(message.channels.push).toBeUndefined();
    expect(dispatchPushNotifications).not.toHaveBeenCalled();
  });

  it("unknown visitor at night: escalates to Urgent across every channel", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "An unfamiliar person at the door.",
      confidence: 0.9,
    });
    // First-time visit this session: no repeat-visitor match at all.
    vi.mocked(resolveRepeatVisitor).mockResolvedValue({
      repeatVisitCount: 0,
      isKnownVisitor: false,
      visitorGroupId: "group_new_visitor",
    });

    const response = await postWebhook(baseUrl, {
      eventId: "evt_unknown_1",
      kind: "ding",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T23:00:00.000Z", // off-hours
      snapshotUrl: "https://cdn.ring.com/snap/evt_unknown_1.jpg",
    });
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));

    const [message] = vi.mocked(broadcastEvent).mock.calls[0];
    expect(message.event.scoring?.signalClass).toBe("Urgent");
    expect(message.channels.visual).toBeDefined();
    expect(message.channels.haptic).toBeDefined();
    expect(message.channels.push).toBeDefined();
    expect(message.event.visitorGroupId).toBe("group_new_visitor");
    await vi.waitFor(() => expect(dispatchPushNotifications).toHaveBeenCalledWith(message.channels.push));
  });

  it("known repeat visitor at night: de-escalates to Routine despite identical off-hours timing", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "The mail carrier, seen earlier today.",
      confidence: 0.9,
    });
    vi.mocked(resolveRepeatVisitor).mockResolvedValue({
      repeatVisitCount: 3,
      isKnownVisitor: true,
      visitorGroupId: "group_mail_carrier",
    });
    vi.mocked(getPreferencesStore).mockReturnValue({
      get: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, knownVisitorTaggingEnabled: true }),
      save: vi.fn(),
    } as never);

    const response = await postWebhook(baseUrl, {
      eventId: "evt_known_1",
      kind: "ding",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T23:00:00.000Z", // same off-hours timestamp as the unknown-visitor case
      snapshotUrl: "https://cdn.ring.com/snap/evt_known_1.jpg",
    });
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));

    const [message] = vi.mocked(broadcastEvent).mock.calls[0];
    expect(message.event.scoring?.signalClass).toBe("Routine");
    expect(message.channels.haptic).toBeUndefined();
    expect(message.channels.push).toBeUndefined();
    expect(message.event.visitorGroupId).toBe("group_mail_carrier");
    expect(dispatchPushNotifications).not.toHaveBeenCalled();
  });

  it("false positive (nighttime shadow/motion): stays Routine instead of crying wolf", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "animal",
      description: "Possibly an animal or a moving shadow; low confidence.",
      confidence: 0.35,
    });

    const response = await postWebhook(baseUrl, {
      eventId: "evt_falsepos_1",
      kind: "motion",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T23:00:00.000Z", // off-hours, which would push a person/package to Urgent
      snapshotUrl: "https://cdn.ring.com/snap/evt_falsepos_1.jpg",
    });
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));

    const [message] = vi.mocked(broadcastEvent).mock.calls[0];
    expect(message.event.scoring?.signalClass).toBe("Routine");
    expect(message.channels.visual).toBeDefined();
    expect(message.channels.haptic).toBeUndefined();
    expect(message.channels.push).toBeUndefined();
    expect(dispatchPushNotifications).not.toHaveBeenCalled();
  });

  it("doorbell press whose snapshot can't be classified: still alerts, from what Ring detected", async () => {
    vi.mocked(classifySnapshot).mockRejectedValue(new Error("Failed to download the Ring snapshot"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postWebhook(baseUrl, {
      eventId: "evt_no_snapshot_1",
      kind: "ding",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T23:00:00.000Z",
      snapshotUrl: "https://cdn.ring.com/snap/missing.jpg",
    });
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));
    const [message] = vi.mocked(broadcastEvent).mock.calls[0];
    expect(message.event.classification).toMatchObject({ category: "person" });
    expect(message.channels.visual?.description).toMatch(/pressed the doorbell/);
    // A stand-in description says nothing about who was there, so it's never matched as a repeat visit.
    expect(resolveRepeatVisitor).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it("degrades gracefully when a motion event can't be classified: webhook is still accepted, error is logged not thrown, and the server keeps serving requests", async () => {
    vi.mocked(classifySnapshot).mockRejectedValueOnce(new Error("Bedrock unavailable"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const failingResponse = await postWebhook(baseUrl, {
      eventId: "evt_failure_1",
      kind: "motion",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T23:00:00.000Z",
      snapshotUrl: "https://cdn.ring.com/snap/evt_failure_1.jpg",
    });
    // The webhook ack happens before runPipeline() runs (see ring/routes.ts),
    // so a downstream classification failure must never turn into a failed
    // webhook response -- Ring has no way to act on that and would retry a
    // delivery that was already accepted and stored. Plain motion has no
    // stand-in classification, so this one produces no alert.
    expect(failingResponse.status).toBe(200);

    await vi.waitFor(() =>
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("pipeline failed for event evt_failure_1"),
        expect.any(Error),
      ),
    );
    expect(broadcastEvent).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();

    // And the server itself is still healthy for the next real event.
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door.",
      confidence: 0.9,
    });
    const nextResponse = await postWebhook(baseUrl, {
      eventId: "evt_after_failure_1",
      kind: "ding",
      deviceId: "dev_front_door",
      createdAt: "2026-09-18T14:00:00.000Z",
      snapshotUrl: "https://cdn.ring.com/snap/evt_after_failure_1.jpg",
    });
    expect(nextResponse.status).toBe(200);
    await vi.waitFor(() => expect(broadcastEvent).toHaveBeenCalledTimes(1));
  });
});
