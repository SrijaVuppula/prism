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

const ENV = {
  RING_CLIENT_ID: "client-123",
  RING_CLIENT_SECRET: "secret-abc",
  RING_REDIRECT_URI: "https://prism.example.com/auth/ring/callback",
  RING_AUTHORIZE_URL: "https://ring.example.com/oauth/authorize",
  RING_TOKEN_URL: "https://ring.example.com/oauth/token",
  RING_WEBHOOK_SECRET: "webhook-secret",
};

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

let server: Server;
let baseUrl: string;
let ringEventStoreMock: { save: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

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
  vi.mocked(runPipeline).mockReset();
  ringEventStoreMock = { save: vi.fn().mockResolvedValue(undefined), get: vi.fn() };
  vi.mocked(getRingEventStore).mockReturnValue(ringEventStoreMock as never);
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
});

describe("POST /webhooks/ring", () => {
  it("accepts a validly signed event, stores it, and kicks off the orchestration pipeline", async () => {
    const payload = {
      event_id: "evt_route_1",
      kind: "person-detected",
      device: { id: "dev_1", description: "Front Door" },
      created_at: "2026-01-01T12:00:00.000Z",
      snapshot_url: "https://cdn.ring.com/snap/evt_route_1.jpg",
    };
    const body = JSON.stringify(payload);
    const signature = sign(body, ENV.RING_WEBHOOK_SECRET);

    const response = await fetch(`${baseUrl}/webhooks/ring`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ring-Signature": signature },
      body,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted", eventId: "evt_route_1" });
    expect(ringEventStoreMock.save).toHaveBeenCalledTimes(1);

    // runPipeline runs after the response without being awaited by the
    // handler; give its microtask a turn before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runPipeline).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runPipeline).mock.calls[0][0]).toMatchObject({ id: "evt_route_1" });
  });

  it("rejects a request with an invalid signature and never starts the pipeline", async () => {
    const payload = {
      event_id: "evt_route_2",
      kind: "ding",
      device: { id: "dev_1" },
      created_at: "2026-01-01T12:00:00.000Z",
      snapshot_url: "https://cdn.ring.com/snap/evt_route_2.jpg",
    };

    const response = await fetch(`${baseUrl}/webhooks/ring`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ring-Signature": "deadbeef" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
    expect(ringEventStoreMock.save).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
  });
});
