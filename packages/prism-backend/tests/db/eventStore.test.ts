import { describe, expect, it, vi } from "vitest";
import type { PrismEvent } from "prism-alert-engine";
import { RingEventStore } from "../../src/db/eventStore";
import type { RawRingEvent } from "../../src/ring/webhookHandler";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const raw: RawRingEvent = {
  event_id: "evt_1",
  kind: "person-detected",
  device: { id: "dev_1", description: "Front Door" },
  created_at: "2026-01-01T12:00:00.000Z",
  snapshot_url: "https://cdn.ring.com/snap/evt_1.jpg",
};

const event: PrismEvent = {
  id: "evt_1",
  occurredAt: "2026-01-01T12:00:00.000Z",
  snapshotUrl: raw.snapshot_url,
};

describe("RingEventStore", () => {
  it("inserts the normalized event and raw payload, ignoring duplicates", async () => {
    const pool = fakePool();
    const store = new RingEventStore(pool);

    await store.save(event, raw);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
    expect(params).toEqual([event.id, raw.kind, JSON.stringify(raw), event.occurredAt, event.snapshotUrl]);
  });

  it("returns null when the event does not exist", async () => {
    const pool = fakePool([]);
    const store = new RingEventStore(pool);

    expect(await store.get("missing")).toBeNull();
  });

  it("maps a stored row back to a PrismEvent", async () => {
    const pool = fakePool([
      { id: "evt_1", occurred_at: new Date("2026-01-01T12:00:00.000Z"), snapshot_url: raw.snapshot_url },
    ]);
    const store = new RingEventStore(pool);

    expect(await store.get("evt_1")).toEqual(event);
  });
});
