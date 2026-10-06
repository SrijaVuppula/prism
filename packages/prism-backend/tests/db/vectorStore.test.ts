import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countVisitorGroupOccurrences,
  findSimilarEvent,
  getImageSimilarityThreshold,
  getSessionWindowMs,
  getSimilarityThreshold,
  pickMatch,
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
  it("defaults to 0.60", () => {
    expect(getSimilarityThreshold()).toBe(0.6);
  });

  it("honors REPEAT_VISITOR_SIMILARITY_THRESHOLD", () => {
    process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD = "0.9";
    expect(getSimilarityThreshold()).toBe(0.9);
  });

  it("falls back to the default when out of (0,1] range", () => {
    process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD = "1.5";
    expect(getSimilarityThreshold()).toBe(0.6);
  });
});

describe("pickMatch", () => {
  const thresholds = { text: 0.85, image: 0.92 };
  const candidate = (eventId: string, textSimilarity: number, imageSimilarity: number | null) => ({
    eventId,
    visitorGroupId: `group_${eventId}`,
    textSimilarity,
    imageSimilarity,
  });

  it("returns null when no candidate clears either threshold", () => {
    expect(pickMatch([candidate("a", 0.8, 0.9), candidate("b", 0.5, null)], thresholds)).toBeNull();
    expect(pickMatch([], thresholds)).toBeNull();
  });

  it("matches on the text signal alone", () => {
    expect(pickMatch([candidate("a", 0.9, null)], thresholds)).toMatchObject({ eventId: "a", matchedBy: "text", similarity: 0.9 });
  });

  it("matches on the image signal alone, even when the wording drifted", () => {
    expect(pickMatch([candidate("a", 0.7, 0.97)], thresholds)).toMatchObject({
      eventId: "a",
      matchedBy: "image",
      textSimilarity: 0.7,
      imageSimilarity: 0.97,
      similarity: 0.97,
    });
  });

  it("reports when both signals agree", () => {
    expect(pickMatch([candidate("a", 0.9, 0.95)], thresholds)).toMatchObject({ matchedBy: "both" });
  });

  it("prefers the strongest qualifying candidate", () => {
    const match = pickMatch([candidate("weak", 0.86, null), candidate("strong", 0.6, 0.99), candidate("none", 0.4, 0.5)], thresholds);
    expect(match?.eventId).toBe("strong");
  });
});

describe("getImageSimilarityThreshold", () => {
  afterEach(() => {
    delete process.env.REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD;
  });

  it("defaults to 0.92 and honors REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD", () => {
    expect(getImageSimilarityThreshold()).toBe(0.92);
    process.env.REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD = "0.95";
    expect(getImageSimilarityThreshold()).toBe(0.95);
    process.env.REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD = "2";
    expect(getImageSimilarityThreshold()).toBe(0.92);
  });
});

describe("findSimilarEvent", () => {
  it("returns null when no prior event exists in the window", async () => {
    const pool = fakePool([]);
    expect(await findSimilarEvent({ text: embedding }, "dev_1", windowStart, pool)).toBeNull();
  });

  it("returns null when no prior event clears a threshold", async () => {
    const pool = fakePool([{ event_id: "evt_old", visitor_group_id: "group_1", text_similarity: 0.5, image_similarity: null }]);
    expect(await findSimilarEvent({ text: embedding }, "dev_1", windowStart, pool)).toBeNull();
  });

  it("compares the text embedding only when there's no image embedding", async () => {
    const pool = fakePool([{ event_id: "evt_old", visitor_group_id: "group_1", text_similarity: 0.92, image_similarity: null }]);
    const match = await findSimilarEvent({ text: embedding }, "dev_1", windowStart, pool);
    expect(match).toMatchObject({ eventId: "evt_old", visitorGroupId: "group_1", similarity: 0.92, matchedBy: "text" });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/embedding <=> \$1::vector/);
    expect(sql).toMatch(/image_embedding <=> \$4::vector/);
    expect(params).toEqual([`[${embedding.join(",")}]`, "dev_1", windowStart, null]);
  });

  it("passes the image embedding and can match on it", async () => {
    const image = [0.9, 0.8, 0.7];
    const pool = fakePool([{ event_id: "evt_old", visitor_group_id: "group_1", text_similarity: 0.3, image_similarity: 0.98 }]);
    const match = await findSimilarEvent({ text: embedding, image }, "dev_1", windowStart, pool);
    expect(match).toMatchObject({ eventId: "evt_old", matchedBy: "image" });
    expect(pool.query.mock.calls[0][1][3]).toBe(`[${image.join(",")}]`);
  });
});

describe("recordEventEmbedding", () => {
  it("inserts the embeddings under the given visitor group, ignoring duplicates", async () => {
    const pool = fakePool();
    await recordEventEmbedding(
      { eventId: "evt_1", deviceId: "dev_1", embedding, visitorGroupId: "group_1" },
      pool,
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO NOTHING/);
    expect(params).toEqual(["evt_1", "dev_1", `[${embedding.join(",")}]`, null, "group_1"]);
  });

  it("stores the image embedding when there is one", async () => {
    const pool = fakePool();
    await recordEventEmbedding(
      { eventId: "evt_1", deviceId: "dev_1", embedding, imageEmbedding: [0.5, 0.5], visitorGroupId: "group_1" },
      pool,
    );
    expect(pool.query.mock.calls[0][1][3]).toBe("[0.5,0.5]");
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
