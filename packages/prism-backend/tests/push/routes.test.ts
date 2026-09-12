import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/push/subscriptionStore", () => ({
  getPushSubscriptionStore: vi.fn(),
}));

import { getPushSubscriptionStore } from "../../src/push/subscriptionStore";
import { pushRouter } from "../../src/push/routes";

const ENV = {
  VAPID_PUBLIC_KEY: "public-key-value",
  VAPID_PRIVATE_KEY: "private-key-value",
  VAPID_SUBJECT: "mailto:ops@example.com",
};

let server: Server;
let baseUrl: string;
let storeMock: { save: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  const app = express();
  app.use(pushRouter);
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
  storeMock = { save: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), list: vi.fn() };
  vi.mocked(getPushSubscriptionStore).mockReturnValue(storeMock as never);
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
});

describe("GET /push/vapid-public-key", () => {
  it("returns the configured VAPID public key", async () => {
    const response = await fetch(`${baseUrl}/push/vapid-public-key`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: ENV.VAPID_PUBLIC_KEY });
  });
});

describe("POST /push/subscribe", () => {
  it("stores a well-formed PushSubscription", async () => {
    const body = { endpoint: "https://push.example.com/abc", keys: { p256dh: "p1", auth: "a1" } };

    const response = await fetch(`${baseUrl}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(201);
    expect(storeMock.save).toHaveBeenCalledWith({ endpoint: body.endpoint, p256dh: "p1", auth: "a1" });
  });

  it("rejects a body missing subscription keys", async () => {
    const response = await fetch(`${baseUrl}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example.com/abc" }),
    });

    expect(response.status).toBe(400);
    expect(storeMock.save).not.toHaveBeenCalled();
  });
});

describe("DELETE /push/subscribe", () => {
  it("removes a subscription by endpoint", async () => {
    const response = await fetch(`${baseUrl}/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example.com/abc" }),
    });

    expect(response.status).toBe(204);
    expect(storeMock.remove).toHaveBeenCalledWith("https://push.example.com/abc");
  });

  it("rejects a missing endpoint", async () => {
    const response = await fetch(`${baseUrl}/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(storeMock.remove).not.toHaveBeenCalled();
  });
});
