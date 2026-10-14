import { describe, expect, it, vi } from "vitest";
import type { CompanionEventMessage } from "../../src/api/websocket";
import { AlertHistoryStore } from "../../src/db/alertHistoryStore";

const MESSAGE: CompanionEventMessage = {
  type: "prism-event",
  event: {
    id: "evt-1",
    occurredAt: "2026-10-14T02:30:00.000Z",
    snapshotUrl: "ring://devices/dev/snapshot?at=1",
    classification: { category: "person", description: "A person at the door.", confidence: 0.95 },
    scoring: { signalScore: 82, signalClass: "Urgent", breakdown: [] } as never,
  },
  channels: {},
  device: { id: "dev", name: "Front Door" },
};

describe("AlertHistoryStore", () => {
  it("stores the delivered message with its time, class and category", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await new AlertHistoryStore(pool as never).save(MESSAGE);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO delivered_alerts/);
    expect(sql).toMatch(/ON CONFLICT \(event_id\) DO UPDATE/);
    expect(params).toEqual(["evt-1", "2026-10-14T02:30:00.000Z", "Urgent", "person", JSON.stringify(MESSAGE)]);
  });

  it("skips a message without classification or scoring", async () => {
    const pool = { query: vi.fn() };
    await new AlertHistoryStore(pool as never).save({ ...MESSAGE, event: { ...MESSAGE.event, scoring: undefined } });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("lists the most recent alerts first, with only the filters given", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ message: MESSAGE }] }) };
    const store = new AlertHistoryStore(pool as never);

    expect(await store.list({ limit: 20 })).toEqual([MESSAGE]);
    let [sql, params] = pool.query.mock.calls[0];
    expect(sql).not.toMatch(/WHERE/);
    expect(sql).toMatch(/ORDER BY occurred_at DESC\s+LIMIT \$1/);
    expect(params).toEqual([20]);

    const since = new Date("2026-10-13T00:00:00Z");
    const until = new Date("2026-10-14T00:00:00Z");
    await store.list({ since, until, signalClass: "Urgent", category: "person", limit: 5 });
    [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/WHERE occurred_at >= \$1 AND occurred_at < \$2 AND signal_class = \$3 AND category = \$4/);
    expect(sql).toMatch(/LIMIT \$5/);
    expect(params).toEqual([since, until, "Urgent", "person", 5]);
  });
});
