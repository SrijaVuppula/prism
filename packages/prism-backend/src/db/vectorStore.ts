// pgvector-backed similarity search for repeat-visitor memory.
// The `pgvector` extension is enabled in 0001_extensions.sql, ahead of this
// being wired up, so no retrofit migration is needed.
//
// "Session window" here means: a rolling time window, scoped to a single
// device, within which repeated visually-similar events are treated as the
// same ongoing visit rather than independent new ones. It resets per
// device -- there's no global session -- and slides forward with every new
// event rather than being a fixed clock-aligned bucket. Its length is
// SESSION_WINDOW_MINUTES (default 45); how similar two descriptions must be
// to count as the same visitor is REPEAT_VISITOR_SIMILARITY_THRESHOLD
// (default 0.85 cosine similarity).

import type { Pool } from "pg";
import { getPool } from "./pool";

export interface SimilarityMatch {
  eventId: string;
  visitorGroupId: string;
  /** Cosine similarity to the query embedding, 0-1 (1 = identical). */
  similarity: number;
}

export interface EventEmbeddingRecord {
  eventId: string;
  deviceId: string;
  embedding: number[];
  visitorGroupId: string;
}

const DEFAULT_SESSION_WINDOW_MINUTES = 45;
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

/** Length of the rolling per-device repeat-visitor session window, in milliseconds. */
export function getSessionWindowMs(): number {
  const minutes = Number(process.env.SESSION_WINDOW_MINUTES ?? DEFAULT_SESSION_WINDOW_MINUTES);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SESSION_WINDOW_MINUTES;
  return safeMinutes * 60_000;
}

/** Minimum cosine similarity for two events to be treated as the same repeat visitor. */
export function getSimilarityThreshold(): number {
  const threshold = Number(process.env.REPEAT_VISITOR_SIMILARITY_THRESHOLD ?? DEFAULT_SIMILARITY_THRESHOLD);
  return Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : DEFAULT_SIMILARITY_THRESHOLD;
}

/** pgvector expects a `[v1,v2,...]` literal for vector-typed query parameters. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Finds the most similar prior event on the same device within the session
 * window, using pgvector cosine distance (`<=>`). Returns null when there's
 * no prior event in-window or the closest one doesn't clear the similarity
 * threshold -- both are treated as "not a repeat visitor", not an error.
 */
export async function findSimilarEvent(
  embedding: number[],
  deviceId: string,
  windowStart: Date,
  pool: Pool = getPool(),
): Promise<SimilarityMatch | null> {
  const result = await pool.query<{ event_id: string; visitor_group_id: string; similarity: number }>(
    `SELECT event_id, visitor_group_id, 1 - (embedding <=> $1::vector) AS similarity
     FROM event_embeddings
     WHERE device_id = $2 AND created_at >= $3
     ORDER BY embedding <=> $1::vector ASC
     LIMIT 1`,
    [toVectorLiteral(embedding), deviceId, windowStart],
  );

  const row = result.rows[0];
  if (!row || row.similarity < getSimilarityThreshold()) {
    return null;
  }

  return { eventId: row.event_id, visitorGroupId: row.visitor_group_id, similarity: row.similarity };
}

/**
 * Stores this event's embedding under a visitor group -- either a newly
 * minted one (no similar prior event) or the group inherited from a match,
 * so the chain of visually-similar events keeps extending. Idempotent on
 * event id, matching the rest of the codebase's webhook-retry tolerance.
 */
export async function recordEventEmbedding(record: EventEmbeddingRecord, pool: Pool = getPool()): Promise<void> {
  await pool.query(
    `INSERT INTO event_embeddings (event_id, device_id, embedding, visitor_group_id, created_at)
     VALUES ($1, $2, $3::vector, $4, now())
     ON CONFLICT (event_id) DO NOTHING`,
    [record.eventId, record.deviceId, toVectorLiteral(record.embedding), record.visitorGroupId],
  );
}

/** Number of events already recorded in this visitor group, on this device, within the window. */
export async function countVisitorGroupOccurrences(
  visitorGroupId: string,
  deviceId: string,
  windowStart: Date,
  pool: Pool = getPool(),
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM event_embeddings
     WHERE visitor_group_id = $1 AND device_id = $2 AND created_at >= $3`,
    [visitorGroupId, deviceId, windowStart],
  );
  return Number(result.rows[0]?.count ?? "0");
}
