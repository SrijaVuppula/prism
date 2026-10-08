import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bedrock/agentOrchestration", () => ({
  runPipeline: vi.fn(),
}));
vi.mock("../../src/db/eventStore", () => ({
  getRingEventStore: vi.fn(),
}));

import { runPipeline } from "../../src/bedrock/agentOrchestration";
import { getRingEventStore } from "../../src/db/eventStore";
import { ringRouter } from "../../src/ring/routes";
import { parseRingSnapshotUrl } from "../../src/ring/snapshots";

const SECRET = "fake-signing-key-for-tests";

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function ringWebhook(type: string, attributes: Record<string, unknown> = {}) {
  return {
    meta: {
      version: "1.1",
      time: "2026-02-14T00:02:53.027052438Z",
      request_id: "c83081fc-2f1b-4cb7-8b18-b18a318b8bab",
      account_id: "ava1.ring.account.XXXYYY",
    },
    data: {
      id: `ava1.ring.device.a_${type}_1771027372393`,
      type,
      attributes: { source: "ava1.ring.device.a", source_type: "devices", timestamp: 1771027372393, ...attributes },
      relationships: { devices: { links: { self: "/v1/devices/ava1.ring.device.a" } } },
    },
  };
}

let server: Server;
let baseUrl: string;
let ringEventStoreMock: { save: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

function post(body: string, signature: string | null = sign(body)) {
  return fetch(`${baseUrl}/webhooks/ring`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "X-Signature": signature } : {}) },
    body,
    signal: AbortSignal.timeout(2000),
  });
}

// runPipeline runs after the response without being awaited by the
// handler; give its microtask a turn before asserting on it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  process.env.RING_WEBHOOK_SECRET = SECRET;
  // Must resolve (not just be reset) since routes.ts calls
  // runPipeline(...).catch(...) synchronously after the response.
  vi.mocked(runPipeline).mockReset().mockResolvedValue({} as never);
  ringEventStoreMock = { save: vi.fn().mockResolvedValue(true), get: vi.fn() };
  vi.mocked(getRingEventStore).mockReturnValue(ringEventStoreMock as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RING_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe("POST /webhooks/ring", () => {
  it("accepts a signed button_press, stores it, and alerts with Ring's snapshot of that moment", async () => {
    const body = JSON.stringify(ringWebhook("button_press"));

    const response = await post(body);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "accepted",
      eventId: "ava1.ring.device.a_button_press_1771027372393",
    });
    const [event, kind, raw] = ringEventStoreMock.save.mock.calls[0];
    expect(kind).toBe("ding");
    expect(raw).toMatchObject({ meta: { account_id: "ava1.ring.account.XXXYYY" } });
    expect(event).toMatchObject({
      id: "ava1.ring.device.a_button_press_1771027372393",
      occurredAt: new Date(1771027372393).toISOString(),
      deviceId: "ava1.ring.device.a",
    });
    expect(parseRingSnapshotUrl(event.snapshotUrl)).toEqual({
      deviceId: "ava1.ring.device.a",
      timestamp: 1771027372393,
      accountId: "ava1.ring.account.XXXYYY",
    });

    await settle();
    expect(runPipeline).toHaveBeenCalledTimes(1);
    const options = vi.mocked(runPipeline).mock.calls[0][2];
    expect(options?.fallbackClassification).toMatchObject({ category: "person" });
    expect(options?.deviceName).toBeUndefined();
  });

  it("uses the simulator's snapshot and device label when the payload carries them", async () => {
    const body = JSON.stringify(
      ringWebhook("motion_detected", {
        sub_type: "human",
        simulator: { snapshot_url: "file:///fixtures/person.jpg", device_name: "Front Door (simulator)" },
      }),
    );

    expect((await post(body)).status).toBe(200);

    expect(ringEventStoreMock.save.mock.calls[0][0].snapshotUrl).toBe("file:///fixtures/person.jpg");
    expect(ringEventStoreMock.save.mock.calls[0][1]).toBe("person-detected");
    await settle();
    expect(vi.mocked(runPipeline).mock.calls[0][2]?.deviceName).toBe("Front Door (simulator)");
  });

  it("acknowledges a redelivered event without running the pipeline again", async () => {
    ringEventStoreMock.save.mockResolvedValue(false);
    const response = await post(JSON.stringify(ringWebhook("button_press")));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "duplicate" });
    await settle();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("acknowledges events Prism doesn't alert on without storing them", async () => {
    for (const type of ["device_added", "device_offline", "app_integration_added", "some_future_event"]) {
      const response = await post(JSON.stringify(ringWebhook(type)));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "received", type });
    }
    expect(ringEventStoreMock.save).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid signature with 401 and never starts the pipeline", async () => {
    const body = JSON.stringify(ringWebhook("button_press"));

    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "sha256=deadbeef")).status).toBe(401);
    expect((await post(body, sign(body, "some-other-key"))).status).toBe(401);

    expect(ringEventStoreMock.save).not.toHaveBeenCalled();
    await settle();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("answers 400 for malformed payloads, which Ring won't retry", async () => {
    for (const body of ["not json", JSON.stringify({ kind: "ding" }), JSON.stringify(ringWebhook("button_press", { timestamp: "soon" }))]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(ringEventStoreMock.save).not.toHaveBeenCalled();
  });

  it("answers 500 when the event can't be stored, so Ring retries it", async () => {
    ringEventStoreMock.save.mockRejectedValue(new Error("db unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await post(JSON.stringify(ringWebhook("button_press")))).status).toBe(500);
    await settle();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("responds with a server error, rather than hanging, when RING_WEBHOOK_SECRET is not set", async () => {
    delete process.env.RING_WEBHOOK_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await post("{}", "sha256=deadbeef")).status).toBe(500);
    expect(ringEventStoreMock.save).not.toHaveBeenCalled();
  });
});
