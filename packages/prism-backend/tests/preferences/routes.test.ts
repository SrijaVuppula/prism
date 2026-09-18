import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/preferences/preferencesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/preferences/preferencesStore")>();
  return { ...actual, getPreferencesStore: vi.fn() };
});

import { DEFAULT_PREFERENCES, getPreferencesStore } from "../../src/preferences/preferencesStore";
import { preferencesRouter } from "../../src/preferences/routes";

let server: Server;
let baseUrl: string;
let storeMock: { get: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  const app = express();
  app.use(preferencesRouter);
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
  storeMock = {
    get: vi.fn().mockResolvedValue(DEFAULT_PREFERENCES),
    save: vi.fn().mockImplementation(async (preferences) => preferences),
  };
  vi.mocked(getPreferencesStore).mockReturnValue(storeMock as never);
});

describe("GET /preferences", () => {
  it("returns the household's current preferences", async () => {
    const response = await fetch(`${baseUrl}/preferences`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("PUT /preferences", () => {
  const valid = {
    hapticOverrides: { Urgent: [100, 50, 100] },
    quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 6 },
    knownVisitorTaggingEnabled: true,
  };

  it("saves a well-formed preferences body", async () => {
    const response = await fetch(`${baseUrl}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(valid),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(valid);
    expect(storeMock.save).toHaveBeenCalledWith(valid);
  });

  it("rejects a body with an invalid quiet-hours field", async () => {
    const response = await fetch(`${baseUrl}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, quietHours: { enabled: true, startHourUtc: 25, endHourUtc: 6 } }),
    });

    expect(response.status).toBe(400);
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("rejects a body with a malformed haptic override", async () => {
    const response = await fetch(`${baseUrl}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...valid, hapticOverrides: { Urgent: "not-an-array" } }),
    });

    expect(response.status).toBe(400);
    expect(storeMock.save).not.toHaveBeenCalled();
  });

  it("rejects a body missing knownVisitorTaggingEnabled", async () => {
    const { knownVisitorTaggingEnabled: _omit, ...rest } = valid;
    const response = await fetch(`${baseUrl}/preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rest),
    });

    expect(response.status).toBe(400);
  });
});
