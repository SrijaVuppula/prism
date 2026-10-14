// How long alert history is kept. Events (and with them the alerts
// delivered for them), repeat-visitor memory and feedback older than
// HISTORY_RETENTION_DAYS (default 30) are deleted automatically, along with
// visitor tags left with no stored visit. The household's settings, push
// subscriptions and Ring account link aren't history and are kept. See
// docs/PRIVACY.md.

import type { Pool } from "pg";
import { getPool } from "./pool";

export const DEFAULT_RETENTION_DAYS = 30;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function getHistoryRetentionDays(): number {
  const raw = process.env.HISTORY_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`HISTORY_RETENTION_DAYS must be a whole number of days, at least 1 (got "${raw}")`);
  }
  return days;
}

/** Deletes history stored before `cutoff`, in one transaction. Returns how many events were deleted. */
export async function deleteHistoryBefore(pool: Pool, cutoff: Date): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM alert_feedback WHERE created_at < $1", [cutoff]);
    await client.query(
      "DELETE FROM event_embeddings WHERE created_at < $1 OR event_id IN (SELECT id FROM ring_events WHERE received_at < $1)",
      [cutoff],
    );
    const events = await client.query("DELETE FROM ring_events WHERE received_at < $1", [cutoff]);
    await client.query(
      "DELETE FROM known_visitor_tags WHERE visitor_group_id NOT IN (SELECT visitor_group_id FROM event_embeddings)",
    );
    await client.query("COMMIT");
    return events.rowCount ?? 0;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Deletes expired history now and every six hours. Failures are logged, never thrown. */
export function startHistoryRetention(
  pool: () => Pool = getPool,
  now: () => number = Date.now,
): ReturnType<typeof setInterval> {
  const sweep = async () => {
    try {
      const days = getHistoryRetentionDays();
      const deleted = await deleteHistoryBefore(pool(), new Date(now() - days * DAY_MS));
      if (deleted > 0) console.log(`[retention] deleted ${deleted} alert(s) older than ${days} days`);
    } catch (err) {
      console.error("[retention] couldn't delete expired history:", err instanceof Error ? err.message : err);
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
