import { describe, expect, it, vi } from "vitest";
import { FeedbackStore } from "../../src/feedback/feedbackStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const feedback = {
  eventId: "evt_1",
  category: "person" as const,
  signalClass: "Urgent" as const,
  signalScore: 82,
  vote: "up" as const,
};

describe("FeedbackStore", () => {
  it("upserts a vote keyed on event id", async () => {
    const pool = fakePool();
    const store = new FeedbackStore(pool);

    await store.record(feedback);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO UPDATE/);
    expect(params).toEqual(["evt_1", "person", "Urgent", 82, "up"]);
  });

  it("aggregates a category tally from stored votes", async () => {
    const pool = fakePool([
      { category: "person", vote: "up", count: "5" },
      { category: "person", vote: "down", count: "2" },
      { category: "animal", vote: "down", count: "1" },
    ]);
    const store = new FeedbackStore(pool);

    expect(await store.getCategoryTally()).toEqual({
      person: { up: 5, down: 2 },
      animal: { up: 0, down: 1 },
    });
  });

  it("returns an empty tally when there is no feedback yet", async () => {
    const pool = fakePool([]);
    const store = new FeedbackStore(pool);
    expect(await store.getCategoryTally()).toEqual({});
  });
});
