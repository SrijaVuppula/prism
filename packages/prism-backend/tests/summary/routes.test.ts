import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/summary/catchUpAgent", () => ({ answerCatchUp: vi.fn() }));

import { answerCatchUp } from "../../src/summary/catchUpAgent";
import { summaryRouter } from "../../src/summary/routes";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(summaryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.mocked(answerCatchUp).mockReset().mockResolvedValue("Nothing happened.");
});

function post(body: unknown) {
  return fetch(`${baseUrl}/catch-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /catch-up", () => {
  it("answers a catch-up since the household last looked", async () => {
    const response = await post({ since: "2026-10-14T06:00:00Z" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ answer: "Nothing happened." });
    expect(answerCatchUp).toHaveBeenCalledWith({ since: new Date("2026-10-14T06:00:00Z") });
  });

  it("passes on the household's question, trimmed, and treats an empty one as none", async () => {
    await post({ question: "  Did a package come?  " });
    await post({ question: "" });
    expect(vi.mocked(answerCatchUp).mock.calls.map(([request]) => request)).toEqual([
      { question: "Did a package come?" },
      {},
    ]);
  });

  it("rejects an overlong question or an unreadable time without asking the model", async () => {
    expect((await post({ question: "x".repeat(301) })).status).toBe(400);
    expect((await post({ question: 42 })).status).toBe(400);
    expect((await post({ since: "yesterday" })).status).toBe(400);
    expect(answerCatchUp).not.toHaveBeenCalled();
  });

  it("answers 502 with a plain message when the agent fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(answerCatchUp).mockRejectedValue(new Error("AccessDeniedException"));

    const response = await post({});
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The catch-up summary isn't available right now." });
  });
});
