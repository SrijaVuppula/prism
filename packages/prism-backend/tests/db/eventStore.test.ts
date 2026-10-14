import { describe, expect, it, vi } from "vitest";
import type { PrismEvent } from "prism-alert-engine";
import { RingEventStore } from "../../src/db/eventStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const raw = { meta: { request_id: "req_1", account_id: "acct" }, data: { id: "evt_1", type: "button_press" } };

const event: PrismEvent = {
  id: "evt_1",
  occurredAt: "2026-01-01T12:00:00.000Z",
  snapshotUrl: "https://cdn.example.com/snap/evt_1.jpg",
};

describe("RingEventStore", () => {
  it("inserts the normalized event, its kind and the raw payload, and reports whether it was new", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as any;
    const store = new RingEventStore(pool);

    expect(await store.save(event, "ding", raw)).toBe(true);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(params).toEqual([event.id, "ding", JSON.stringify(raw), event.occurredAt, event.snapshotUrl]);
  });

  it("reports a duplicate delivery as not new", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as any;
    expect(await new RingEventStore(pool).save(event, "ding", raw)).toBe(false);
  });

  it("finds an event from the same device near a time, whether it came by webhook or from the event history", async () => {
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{}], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 }) } as any;
    const store = new RingEventStore(pool);

    expect(await store.hasEventNear("dev-a", "2026-01-01T12:00:00.000Z", 15_000)).toBe(true);
    expect(await store.hasEventNear("dev-a", "2026-01-01T13:00:00.000Z", 15_000)).toBe(false);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/make_interval\(secs => \$3\)/);
    expect(sql).toMatch(/'\{data,attributes,source\}' = \$1 OR raw_payload #>> '\{relationships,source,data,id\}' = \$1/);
    expect(params).toEqual(["dev-a", "2026-01-01T12:00:00.000Z", 15]);
  });

  it("returns null when the event does not exist", async () => {
    const pool = fakePool([]);
    const store = new RingEventStore(pool);

    expect(await store.get("missing")).toBeNull();
  });

  it("maps a stored row back to a PrismEvent", async () => {
    const pool = fakePool([
      { id: "evt_1", occurred_at: new Date("2026-01-01T12:00:00.000Z"), snapshot_url: event.snapshotUrl },
    ]);
    const store = new RingEventStore(pool);

    expect(await store.get("evt_1")).toEqual(event);
  });
});
