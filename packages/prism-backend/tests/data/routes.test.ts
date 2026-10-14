import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/db/pool", () => ({ getPool: vi.fn() }));
vi.mock("../../src/db/clearHistory", () => ({ clearHistory: vi.fn() }));
vi.mock("../../src/feedback/weightAdjustment", () => ({ resetSignalScoreWeightsCache: vi.fn() }));
vi.mock("../../src/ring/snapshots", () => ({ getRingSnapshotLoader: vi.fn() }));

import { dataRouter } from "../../src/data/routes";
import { clearHistory } from "../../src/db/clearHistory";
import { getPool } from "../../src/db/pool";
import { resetSignalScoreWeightsCache } from "../../src/feedback/weightAdjustment";
import { getRingSnapshotLoader } from "../../src/ring/snapshots";

let server: Server;
let baseUrl: string;
let pool: { query: ReturnType<typeof vi.fn> };
let clearSnapshots: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const app = express();
  app.use(dataRouter);
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
  delete process.env.HISTORY_RETENTION_DAYS;
  pool = { query: vi.fn().mockResolvedValue({ rows: [{ count: "12" }] }) };
  vi.mocked(getPool).mockReturnValue(pool as never);
  vi.mocked(clearHistory).mockReset().mockResolvedValue(undefined);
  vi.mocked(resetSignalScoreWeightsCache).mockReset();
  clearSnapshots = vi.fn();
  vi.mocked(getRingSnapshotLoader).mockReturnValue({ clear: clearSnapshots } as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GET /data", () => {
  it("says how long history is kept and how many alerts are stored", async () => {
    const response = await fetch(`${baseUrl}/data`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ retentionDays: 30, storedAlerts: 12 });
  });
});

describe("DELETE /data/history", () => {
  it("deletes the history and forgets what was derived from it", async () => {
    const response = await fetch(`${baseUrl}/data/history`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ storedAlerts: 0 });
    expect(clearHistory).toHaveBeenCalledWith(pool);
    expect(resetSignalScoreWeightsCache).toHaveBeenCalled();
    expect(clearSnapshots).toHaveBeenCalled();
  });

  it("reports a failure, and keeps the derived caches, when the delete fails", async () => {
    vi.mocked(clearHistory).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await fetch(`${baseUrl}/data/history`, { method: "DELETE" })).status).toBe(500);
    expect(resetSignalScoreWeightsCache).not.toHaveBeenCalled();
  });
});
