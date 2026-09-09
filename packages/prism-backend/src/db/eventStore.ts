// Persistence for inbound Ring events: the raw payload (for audit/debugging)
// alongside the normalized PrismEvent fields. Stood up now, ahead of the
// classification/scoring pipeline, so no event is ever accepted and then
// dropped on the floor.

import type { Pool } from "pg";
import type { PrismEvent } from "prism-alert-engine";
import { getPool } from "./pool";
import type { RawRingEvent } from "../ring/webhookHandler";

export class RingEventStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Stores a normalized event and its raw source payload. Idempotent on
   * event id, since webhook senders (Ring included) commonly retry on a
   * slow or dropped response.
   */
  async save(event: PrismEvent, raw: RawRingEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO ring_events (id, kind, raw_payload, occurred_at, snapshot_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [event.id, raw.kind, JSON.stringify(raw), event.occurredAt, event.snapshotUrl],
    );
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
