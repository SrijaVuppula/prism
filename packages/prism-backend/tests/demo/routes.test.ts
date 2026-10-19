import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/ring/routes", () => ({ startAlert: vi.fn() }));
vi.mock("../../src/preferences/preferencesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/preferences/preferencesStore")>();
  return { ...actual, getPreferencesStore: vi.fn() };
});

import { demoRouter, resetTestVisitors } from "../../src/demo/routes";
import { SAMPLE_EVENTS, TEST_VISITORS } from "../../src/demo/testVisitors";
import { DEFAULT_PREFERENCES, getPreferencesStore } from "../../src/preferences/preferencesStore";
import { startAlert } from "../../src/ring/routes";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(demoRouter);
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T21:30:00Z"));
  resetTestVisitors();
  vi.mocked(startAlert).mockReset().mockResolvedValue(true);
  vi.mocked(getPreferencesStore).mockReturnValue({
    get: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, timeZone: "America/Los_Angeles" }),
  } as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.TEST_VISITOR;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const press = () => fetch(`${baseUrl}/test-visitor`, { method: "POST" });

describe("POST /test-visitor", () => {
  it("sends each simulated event in turn through the webhook path", async () => {
    const labels: string[] = [];
    for (let i = 0; i < TEST_VISITORS.length + 1; i += 1) {
      const response = await press();
      expect(response.status).toBe(202);
      labels.push(((await response.json()) as { label: string }).label);
      vi.setSystemTime(Date.now() + 5_000);
    }

    expect(labels).toEqual([...TEST_VISITORS.map((sample) => sample.label), TEST_VISITORS[0].label]);
    // The story comes first: a repeat visit, then the Urgent night-time visitor.
    expect(labels.slice(0, SAMPLE_EVENTS.length)).toEqual(SAMPLE_EVENTS.map((sample) => sample.label));
    const [alert, raw] = vi.mocked(startAlert).mock.calls[0];
    expect(alert).toMatchObject({ kind: "ding", deviceName: "Front Door (simulator)" });
    expect(raw).toMatchObject({ meta: { version: "1.1" }, data: { type: "button_press" } });
  });

  it("sends the night-time visit late at night in the household's time zone", async () => {
    for (let i = 0; i < 4; i += 1) {
      await press();
      vi.setSystemTime(Date.now() + 5_000);
    }
    await press();

    const [alert] = vi.mocked(startAlert).mock.calls[4];
    expect(alert.kind).toBe("person-detected");
    expect(alert.event.occurredAt).toBe("2026-10-14T06:30:20.000Z");
  });

  it("sends one visitor for a double tap", async () => {
    expect((await press()).status).toBe(202);
    expect((await press()).status).toBe(429);
    expect(startAlert).toHaveBeenCalledTimes(1);
  });

  it("stops at TEST_VISITOR_DAILY_LIMIT for the day", async () => {
    process.env.TEST_VISITOR_DAILY_LIMIT = "2";
    resetTestVisitors();
    for (const expected of [202, 202, 429]) {
      const response = await press();
      expect(response.status).toBe(expected);
      vi.setSystemTime(Date.now() + 5_000);
    }
    expect(startAlert).toHaveBeenCalledTimes(2);
    delete process.env.TEST_VISITOR_DAILY_LIMIT;
  });

  it("is off when TEST_VISITOR is off", async () => {
    process.env.TEST_VISITOR = "off";
    expect((await press()).status).toBe(404);
    expect(startAlert).not.toHaveBeenCalled();
  });
});
