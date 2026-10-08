import { describe, expect, it, vi } from "vitest";
import { clearHistory, HISTORY_TABLES } from "../../src/db/clearHistory";

describe("clearHistory", () => {
  it("truncates events, repeat-visitor memory, feedback and visitor tags in one statement", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as any;

    await clearHistory(pool);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      "TRUNCATE ring_events, event_embeddings, alert_feedback, known_visitor_tags",
    );
  });

  it("never touches settings, push subscriptions, the Ring account link or migration history", () => {
    for (const kept of ["user_preferences", "push_subscriptions", "ring_account_links", "schema_migrations"]) {
      expect(HISTORY_TABLES).not.toContain(kept);
    }
  });
});
