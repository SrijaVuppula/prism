import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/feedback/feedbackStore", () => ({
  getFeedbackStore: vi.fn(),
}));

import { getFeedbackStore } from "../../src/feedback/feedbackStore";
import { feedbackRouter } from "../../src/feedback/routes";

let server: Server;
let baseUrl: string;
let storeMock: { record: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  const app = express();
  app.use(feedbackRouter);
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
  storeMock = { record: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(getFeedbackStore).mockReturnValue(storeMock as never);
});

describe("POST /alerts/:eventId/feedback", () => {
  const body = { vote: "up", category: "person", signalClass: "Urgent", signalScore: 82 };

  it("records a well-formed vote", async () => {
    const response = await fetch(`${baseUrl}/alerts/evt_1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(201);
    expect(storeMock.record).toHaveBeenCalledWith({ eventId: "evt_1", ...body });
  });

  it("rejects an invalid vote value", async () => {
    const response = await fetch(`${baseUrl}/alerts/evt_1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, vote: "sideways" }),
    });

    expect(response.status).toBe(400);
    expect(storeMock.record).not.toHaveBeenCalled();
  });

  it("rejects a signalScore outside 0-100", async () => {
    const response = await fetch(`${baseUrl}/alerts/evt_1/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, signalScore: 200 }),
    });

    expect(response.status).toBe(400);
    expect(storeMock.record).not.toHaveBeenCalled();
  });
});
