import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/eventStore", () => ({
  getRingEventStore: vi.fn(),
}));
vi.mock("../../src/bedrock/multimodalContext", () => ({
  loadSnapshotBytes: vi.fn(),
}));
vi.mock("../../src/db/alertHistoryStore", () => ({
  getAlertHistoryStore: vi.fn(),
}));

import { loadSnapshotBytes } from "../../src/bedrock/multimodalContext";
import { getRingEventStore } from "../../src/db/eventStore";
import { getAlertHistoryStore } from "../../src/db/alertHistoryStore";
import { eventsRouter } from "../../src/events/routes";

let server: Server;
let baseUrl: string;
let eventStoreMock: { get: ReturnType<typeof vi.fn> };
let listAlerts: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const app = express();
  app.use(eventsRouter);
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
  eventStoreMock = { get: vi.fn() };
  vi.mocked(getRingEventStore).mockReturnValue(eventStoreMock as never);
  vi.mocked(loadSnapshotBytes).mockReset();
  listAlerts = vi.fn().mockResolvedValue([{ type: "prism-event", event: { id: "evt_1" } }]);
  vi.mocked(getAlertHistoryStore).mockReturnValue({ list: listAlerts } as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /alerts", () => {
  it("lists the 20 most recent delivered alerts by default", async () => {
    const response = await fetch(`${baseUrl}/alerts`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alerts: [{ type: "prism-event", event: { id: "evt_1" } }] });
    expect(listAlerts).toHaveBeenCalledWith({ limit: 20 });
  });

  it("caps the limit at 50 and rejects one that isn't a positive whole number", async () => {
    await fetch(`${baseUrl}/alerts?limit=500`);
    expect(listAlerts).toHaveBeenCalledWith({ limit: 50 });
    for (const limit of ["0", "-1", "ten", "2.5"]) {
      expect((await fetch(`${baseUrl}/alerts?limit=${limit}`)).status).toBe(400);
    }
  });
});

describe("GET /events/:eventId/snapshot", () => {
  it("serves the stored event's snapshot bytes with their media type", async () => {
    eventStoreMock.get.mockResolvedValue({
      id: "evt_1",
      occurredAt: "2026-01-01T12:00:00.000Z",
      snapshotUrl: "file:///fixtures/person.jpg",
    });
    vi.mocked(loadSnapshotBytes).mockResolvedValue({ bytes: Buffer.from([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" });

    const response = await fetch(`${baseUrl}/events/evt_1/snapshot`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(eventStoreMock.get).toHaveBeenCalledWith("evt_1");
    expect(loadSnapshotBytes).toHaveBeenCalledWith("file:///fixtures/person.jpg");
  });

  it("returns 404 for an unknown event without trying to load anything", async () => {
    eventStoreMock.get.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/events/nope/snapshot`);

    expect(response.status).toBe(404);
    expect(loadSnapshotBytes).not.toHaveBeenCalled();
  });

  it("returns 502 when the snapshot can't be loaded", async () => {
    eventStoreMock.get.mockResolvedValue({
      id: "evt_2",
      occurredAt: "2026-01-01T12:00:00.000Z",
      snapshotUrl: "https://cdn.example.com/expired.jpg",
    });
    vi.mocked(loadSnapshotBytes).mockRejectedValue(new Error("Snapshot fetch returned 403"));

    const response = await fetch(`${baseUrl}/events/evt_2/snapshot`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Snapshot unavailable" });
  });
});
