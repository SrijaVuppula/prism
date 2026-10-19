import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/bedrock/agentOrchestration", () => ({
  runPipeline: vi.fn(),
}));
vi.mock("../../src/db/eventStore", () => ({
  getRingEventStore: vi.fn(),
}));

import { runPipeline } from "../../src/bedrock/agentOrchestration";
import { getRingEventStore } from "../../src/db/eventStore";
import { sendForgedWebhooks } from "../../src/demo/forgedWebhooks";
import { ringRouter } from "../../src/ring/routes";

let server: Server;
let webhookUrl: string;

beforeAll(async () => {
  process.env.RING_WEBHOOK_SECRET = "the-servers-own-signing-key";
  const app = express();
  app.use(ringRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  webhookUrl = `http://127.0.0.1:${port}/webhooks/ring`;
});

afterAll(() => {
  server.close();
  delete process.env.RING_WEBHOOK_SECRET;
});

describe("sendForgedWebhooks", () => {
  it("sends an unsigned and a wrongly signed webhook, which the real webhook route rejects before storing or alerting", async () => {
    const results = await sendForgedWebhooks(webhookUrl);

    expect(results.map((result) => result.attempt)).toEqual([
      "no X-Signature header",
      "signed with a key that isn't the server's",
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ status: 401, rejected: true });
    }
    expect(getRingEventStore).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
  });

  it("reports a forgery the server accepted", async () => {
    // A fresh Response per call, since a body can only be read once.
    const accepting = vi.fn(async () => new Response(JSON.stringify({ status: "accepted" }), { status: 200 }));

    const results = await sendForgedWebhooks("https://prism.example/webhooks/ring", accepting);

    expect(results.every((result) => !result.rejected)).toBe(true);
    expect(accepting).toHaveBeenCalledTimes(2);
  });
});
