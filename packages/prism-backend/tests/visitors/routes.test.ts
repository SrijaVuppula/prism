import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/knownVisitorTagStore", () => ({
  getKnownVisitorTagStore: vi.fn(),
}));
vi.mock("../../src/preferences/preferencesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/preferences/preferencesStore")>();
  return { ...actual, getPreferencesStore: vi.fn() };
});

import { getKnownVisitorTagStore } from "../../src/db/knownVisitorTagStore";
import { DEFAULT_PREFERENCES, getPreferencesStore } from "../../src/preferences/preferencesStore";
import { visitorsRouter } from "../../src/visitors/routes";

let server: Server;
let baseUrl: string;
let tagStoreMock: { tag: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; find: ReturnType<typeof vi.fn> };

beforeAll(async () => {
  const app = express();
  app.use(visitorsRouter);
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
  tagStoreMock = { tag: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), find: vi.fn() };
  vi.mocked(getKnownVisitorTagStore).mockReturnValue(tagStoreMock as never);
  vi.mocked(getPreferencesStore).mockReturnValue({
    get: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, knownVisitorTaggingEnabled: true }),
    save: vi.fn(),
  } as never);
});

describe("POST /visitors/:visitorGroupId/tag", () => {
  it("tags a visitor group when tagging is enabled", async () => {
    const response = await fetch(`${baseUrl}/visitors/group_1/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Mail carrier" }),
    });

    expect(response.status).toBe(201);
    expect(tagStoreMock.tag).toHaveBeenCalledWith("group_1", "Mail carrier");
  });

  it("rejects tagging when the household has not opted in", async () => {
    vi.mocked(getPreferencesStore).mockReturnValue({
      get: vi.fn().mockResolvedValue(DEFAULT_PREFERENCES),
      save: vi.fn(),
    } as never);

    const response = await fetch(`${baseUrl}/visitors/group_1/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Mail carrier" }),
    });

    expect(response.status).toBe(403);
    expect(tagStoreMock.tag).not.toHaveBeenCalled();
  });

  it("rejects a missing label", async () => {
    const response = await fetch(`${baseUrl}/visitors/group_1/tag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(tagStoreMock.tag).not.toHaveBeenCalled();
  });
});

describe("DELETE /visitors/:visitorGroupId/tag", () => {
  it("removes a tag", async () => {
    const response = await fetch(`${baseUrl}/visitors/group_1/tag`, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(tagStoreMock.remove).toHaveBeenCalledWith("group_1");
  });
});

describe("GET /visitors/:visitorGroupId/tag", () => {
  it("returns 404 when no tag exists", async () => {
    tagStoreMock.find.mockResolvedValue(null);
    const response = await fetch(`${baseUrl}/visitors/group_1/tag`);
    expect(response.status).toBe(404);
  });

  it("returns the tag when one exists", async () => {
    tagStoreMock.find.mockResolvedValue({ visitorGroupId: "group_1", label: "Mail carrier" });
    const response = await fetch(`${baseUrl}/visitors/group_1/tag`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ visitorGroupId: "group_1", label: "Mail carrier" });
  });
});
