import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countVisitorGroupOccurrences,
  findSimilarEvent,
  getSessionWindowMs,
  getSimilarityThreshold,
  recordEventEmbedding,
} from "../../src/db/vectorStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const embedding = [0.1, 0.2, 0.3];
const windowStart = new Date("2026-01-01T00:00:00.000Z");

afterEach(() => {
  delete process.env.SESSION_WINDOW_MINUTES;
  delete process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD;
});

describe("getSessionWindowMs", () => {
  it("defaults to 45 minutes", () => {
    expect(getSessionWindowMs()).toBe(45 * 60_000);
  });

  it("honors SESSION_WINDOW_MINUTES", () => {
    process.env.SESSION_WINDOW_MINUTES = "30";
    expect(getSessionWindowMs()).toBe(30 * 60_000);
  });

  it("falls back to the default for an invalid value", () => {
    process.env.SESSION_WINDOW_MINUTES = "not-a-number";
    expect(getSessionWindowMs()).toBe(45 * 60_000);
  });
});

describe("getSimilarityThreshold", () => {
  it("defaults to 0.85", () => {
    expect(getSimilarityThreshold()).toBe(0.85);
  });

  it("honors REPEAT_VISITOR_SIMILARITY_THRESHOLD", () => {
    process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD = "0.9";
    expect(getSimilarityThreshold()).toBe(0.9);
  });

  it("falls back to the default when out of (0,1] range", () => {
    process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD = "1.5";
    expect(getSimilarityThreshold()).toBe(0.85);
  });
});

describe("findSimilarEvent", () => {
  it("returns null when no prior event exists in the window", async () => {
    const pool = fakePool([]);
    expect(await findSimilarEvent(embedding, "dev_1", windowStart, pool)).toBeNull();
  });

  it("returns null when the closest match doesn't clear the similarity threshold", async () => {
    const pool = fakePool([{ event_id: "evt_old", visitor_group_id: "group_1", similarity: 0.5 }]);
    expect(await findSimilarEvent(embedding, "dev_1", windowStart, pool)).toBeNull();
  });

  it("returns the match when it clears the similarity threshold", async () => {
    const pool = fakePool([{ event_id: "evt_old", visitor_group_id: "group_1", similarity: 0.92 }]);
    const match = await findSimilarEvent(embedding, "dev_1", windowStart, pool);
    expect(match).toEqual({ eventId: "evt_old", visitorGroupId: "group_1", similarity: 0.92 });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/embedding <=> \$1::vector/);
    expect(params).toEqual([`[${embedding.join(",")}]`, "dev_1", windowStart]);
  });
});

describe("recordEventEmbedding", () => {
  it("inserts the embedding under the given visitor group, ignoring duplicates", async () => {
    const pool = fakePool();
    await recordEventEmbedding(
      { eventId: "evt_1", deviceId: "dev_1", embedding, visitorGroupId: "group_1" },
      pool,
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
    expect(params).toEqual(["evt_1", "dev_1", `[${embedding.join(",")}]`, "group_1"]);
  });
});

describe("countVisitorGroupOccurrences", () => {
  it("returns the count of prior events in the visitor group within the window", async () => {
    const pool = fakePool([{ count: "3" }]);
    expect(await countVisitorGroupOccurrences("group_1", "dev_1", windowStart, pool)).toBe(3);
  });

  it("returns 0 when there is no row", async () => {
    const pool = fakePool([]);
    expect(await countVisitorGroupOccurrences("group_1", "dev_1", windowStart, pool)).toBe(0);
  });
});
