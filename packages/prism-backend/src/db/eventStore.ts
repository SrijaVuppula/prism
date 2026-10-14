// Persistence for inbound Ring events: the raw payload (for audit/debugging)
// alongside the normalized PrismEvent fields. Stood up now, ahead of the
// classification/scoring pipeline, so no event is ever accepted and then
// dropped on the floor.

import type { Pool } from "pg";
import type { PrismEvent } from "prism-alert-engine";
import { getPool } from "./pool";

export class RingEventStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Stores a normalized event, what kind of event it was, and the raw
   * webhook payload. Idempotent on event id, since Ring retries deliveries
   * and may send the same event more than once: returns false when the
   * event was already stored, so the caller doesn't process it twice.
   */
  async save(event: PrismEvent, kind: string, raw: unknown): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ring_events (id, kind, raw_payload, occurred_at, snapshot_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, kind, JSON.stringify(raw), event.occurredAt, event.snapshotUrl],
    );
    return result.rowCount === 1;
  }

  /**
   * Whether an event from this device was already stored within
   * `windowMs` of `occurredAt`, however it arrived. Ring's event history
   * and its webhooks give the same event different ids, so they're matched
   * by device and time.
   */
  async hasEventNear(deviceId: string, occurredAt: string, windowMs: number): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ring_events
       WHERE occurred_at BETWEEN $2::timestamptz - make_interval(secs => $3) AND $2::timestamptz + make_interval(secs => $3)
         AND (raw_payload #>> '{data,attributes,source}' = $1 OR raw_payload #>> '{relationships,source,data,id}' = $1)
       LIMIT 1`,
      [deviceId, occurredAt, windowMs / 1000],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async get(id: string): Promise<PrismEvent | null> {
    const result = await this.pool.query<{ id: string; occurred_at: Date; snapshot_url: string }>(
      `SELECT id, occurred_at, snapshot_url FROM ring_events WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      snapshotUrl: row.snapshot_url,
    };
  }
}

export function getRingEventStore(): RingEventStore {
  return new RingEventStore(getPool());
}
