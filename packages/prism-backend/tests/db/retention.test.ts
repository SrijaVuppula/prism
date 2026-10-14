import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETENTION_DAYS,
  deleteHistoryBefore,
  getHistoryRetentionDays,
  startHistoryRetention,
} from "../../src/db/retention";

function fakePool(deletedEvents = 2) {
  const client = {
    query: vi.fn().mockImplementation(async (sql: string) =>
      sql.startsWith("DELETE FROM ring_events") ? { rowCount: deletedEvents } : { rowCount: 0 },
    ),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn().mockResolvedValue(client) } as any, client };
}

afterEach(() => {
  delete process.env.HISTORY_RETENTION_DAYS;
  vi.restoreAllMocks();
});

describe("getHistoryRetentionDays", () => {
  it("defaults to 30 days and reads HISTORY_RETENTION_DAYS", () => {
    expect(getHistoryRetentionDays()).toBe(DEFAULT_RETENTION_DAYS);
    process.env.HISTORY_RETENTION_DAYS = "7";
    expect(getHistoryRetentionDays()).toBe(7);
  });

  it("rejects anything but a whole number of days", () => {
    for (const value of ["0", "-3", "1.5", "a week"]) {
      process.env.HISTORY_RETENTION_DAYS = value;
      expect(() => getHistoryRetentionDays()).toThrow(/HISTORY_RETENTION_DAYS/);
    }
  });
});

describe("deleteHistoryBefore", () => {
  const cutoff = new Date("2026-09-14T00:00:00Z");

  it("deletes older feedback, visitor memory and events, then orphaned tags, in one transaction", async () => {
    const { pool, client } = fakePool(3);

    expect(await deleteHistoryBefore(pool, cutoff)).toBe(3);

    const statements = client.query.mock.calls.map(([sql]) => sql);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toMatch(/^DELETE FROM alert_feedback WHERE created_at < \$1/);
    expect(statements[2]).toMatch(/^DELETE FROM event_embeddings WHERE created_at < \$1 OR event_id IN/);
    expect(statements[3]).toMatch(/^DELETE FROM ring_events WHERE received_at < \$1/);
    expect(statements[4]).toMatch(/^DELETE FROM known_visitor_tags WHERE visitor_group_id NOT IN/);
    expect(statements[5]).toBe("COMMIT");
    for (const call of client.query.mock.calls.slice(1, 4)) {
      expect(call[1]).toEqual([cutoff]);
    }
    expect(client.release).toHaveBeenCalled();
  });

  it("rolls back and releases the connection when a delete fails", async () => {
    const { pool, client } = fakePool();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("DELETE FROM ring_events")) throw new Error("db down");
      return { rowCount: 0 };
    });

    await expect(deleteHistoryBefore(pool, cutoff)).rejects.toThrow(/db down/);
    expect(client.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
    expect(client.query.mock.calls.map(([sql]) => sql)).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalled();
  });
});

describe("startHistoryRetention", () => {
  it("deletes history older than the retention period right away, and logs rather than throws", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.HISTORY_RETENTION_DAYS = "10";
    const now = Date.parse("2026-10-14T12:00:00Z");
    const { pool, client } = fakePool();

    clearInterval(startHistoryRetention(() => pool, () => now));
    await vi.waitFor(() => expect(client.release).toHaveBeenCalled());
    expect(client.query.mock.calls[1][1]).toEqual([new Date("2026-10-04T12:00:00Z")]);

    const failing = { connect: vi.fn().mockRejectedValue(new Error("no database")) } as any;
    clearInterval(startHistoryRetention(() => failing, () => now));
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringMatching(/retention/), "no database"));
  });
});
