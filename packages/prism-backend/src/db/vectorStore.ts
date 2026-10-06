// pgvector-backed similarity search for repeat-visitor memory.
// The `pgvector` extension is enabled in 0001_extensions.sql, ahead of this
// being wired up, so no retrofit migration is needed.
//
// "Session window" here means: a rolling time window, scoped to a single
// device, within which repeated visually-similar events are treated as the
// same ongoing visit rather than independent new ones. It resets per
// device -- there's no global session -- and slides forward with every new
// event rather than being a fixed clock-aligned bucket. Its length is
// SESSION_WINDOW_MINUTES (default 45).
//
// Two signals can match a visit to an earlier one, each with its own
// threshold, and either is enough:
// - text: the embedded visitor signature (or description) -- cosine
//   similarity >= REPEAT_VISITOR_SIMILARITY_THRESHOLD (default 0.85);
// - image (only when image embeddings are on): the embedded snapshot --
//   cosine similarity >= REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD (default
//   0.92). Kept high on purpose: frames from one fixed doorbell camera share
//   their whole background, so only a near-identical frame (someone still
//   standing at the door across several motion events) should match on the
//   image alone.

import type { Pool } from "pg";
import { getPool } from "./pool";

export interface SimilarityMatch {
  eventId: string;
  visitorGroupId: string;
  /** The stronger of the two cosine similarities that matched, 0-1 (1 = identical). */
  similarity: number;
  textSimilarity: number;
  /** Null when either event has no image embedding. */
  imageSimilarity: number | null;
  /** Which signal(s) cleared their threshold. */
  matchedBy: "text" | "image" | "both";
}

export interface EventEmbeddingRecord {
  eventId: string;
  deviceId: string;
  /** Embedded visitor signature (or description). */
  embedding: number[];
  /** Embedded snapshot, when image embeddings are on. */
  imageEmbedding?: number[];
  visitorGroupId: string;
}

/** A prior in-window event with its similarity to the current one on each signal. */
export interface MatchCandidate {
  eventId: string;
  visitorGroupId: string;
  textSimilarity: number;
  imageSimilarity: number | null;
}

const DEFAULT_SESSION_WINDOW_MINUTES = 45;
const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
const DEFAULT_IMAGE_SIMILARITY_THRESHOLD = 0.92;
// Upper bound on prior events compared per lookup; one device rarely has
// anywhere near this many events inside a session window.
const MAX_CANDIDATES = 50;

/** Length of the rolling per-device repeat-visitor session window, in milliseconds. */
export function getSessionWindowMs(): number {
  const minutes = Number(process.env.SESSION_WINDOW_MINUTES ?? DEFAULT_SESSION_WINDOW_MINUTES);
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_SESSION_WINDOW_MINUTES;
  return safeMinutes * 60_000;
}

function thresholdFromEnv(name: string, fallback: number): number {
  const threshold = Number(process.env[name] ?? fallback);
  return Number.isFinite(threshold) && threshold > 0 && threshold <= 1 ? threshold : fallback;
}

/** Minimum text (visitor signature) cosine similarity for two events to be the same repeat visitor. */
export function getSimilarityThreshold(): number {
  return thresholdFromEnv("REPEAT_VISITOR_SIMILARITY_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD);
}

/** Minimum snapshot-image cosine similarity for two events to be the same repeat visitor. */
export function getImageSimilarityThreshold(): number {
  return thresholdFromEnv("REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD", DEFAULT_IMAGE_SIMILARITY_THRESHOLD);
}

/**
 * Picks the prior event this one repeats, if any: a candidate qualifies when
 * either signal clears its threshold, and the strongest qualifying
 * similarity wins. Pure, so the rule is testable without a database.
 */
export function pickMatch(
  candidates: MatchCandidate[],
  thresholds: { text: number; image: number } = { text: getSimilarityThreshold(), image: getImageSimilarityThreshold() },
): SimilarityMatch | null {
  let best: SimilarityMatch | null = null;
  for (const candidate of candidates) {
    const textMatches = candidate.textSimilarity >= thresholds.text;
    const imageMatches = candidate.imageSimilarity !== null && candidate.imageSimilarity >= thresholds.image;
    if (!textMatches && !imageMatches) continue;

    const similarity = Math.max(candidate.textSimilarity, candidate.imageSimilarity ?? 0);
    if (!best || similarity > best.similarity) {
      best = {
        eventId: candidate.eventId,
        visitorGroupId: candidate.visitorGroupId,
        similarity,
        textSimilarity: candidate.textSimilarity,
        imageSimilarity: candidate.imageSimilarity,
        matchedBy: textMatches && imageMatches ? "both" : textMatches ? "text" : "image",
      };
    }
  }
  return best;
}

/** pgvector expects a `[v1,v2,...]` literal for vector-typed query parameters. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Finds the prior event on the same device within the session window that
 * this one repeats, comparing both signals with pgvector cosine distance
 * (`<=>`). Returns null when nothing in-window clears either threshold --
 * treated as "not a repeat visitor", not an error.
 */
export async function findSimilarEvent(
  embeddings: { text: number[]; image?: number[] },
  deviceId: string,
  windowStart: Date,
  pool: Pool = getPool(),
): Promise<SimilarityMatch | null> {
  const result = await pool.query<{
    event_id: string;
    visitor_group_id: string;
    text_similarity: number;
    image_similarity: number | null;
  }>(
    `SELECT event_id, visitor_group_id,
            1 - (embedding <=> $1::vector) AS text_similarity,
            CASE WHEN $4::vector IS NULL OR image_embedding IS NULL THEN NULL
                 ELSE 1 - (image_embedding <=> $4::vector) END AS image_similarity
     FROM event_embeddings
     WHERE device_id = $2 AND created_at >= $3
     ORDER BY created_at DESC
     LIMIT ${MAX_CANDIDATES}`,
    [
      toVectorLiteral(embeddings.text),
      deviceId,
      windowStart,
      embeddings.image ? toVectorLiteral(embeddings.image) : null,
    ],
  );

  return pickMatch(
    result.rows.map((row) => ({
      eventId: row.event_id,
      visitorGroupId: row.visitor_group_id,
      textSimilarity: Number(row.text_similarity),
      imageSimilarity: row.image_similarity === null ? null : Number(row.image_similarity),
    })),
  );
}

/**
 * Stores this event's embedding under a visitor group -- either a newly
 * minted one (no similar prior event) or the group inherited from a match,
 * so the chain of visually-similar events keeps extending. Idempotent on
 * event id, matching the rest of the codebase's webhook-retry tolerance.
 */
export async function recordEventEmbedding(record: EventEmbeddingRecord, pool: Pool = getPool()): Promise<void> {
  await pool.query(
    `INSERT INTO event_embeddings (event_id, device_id, embedding, image_embedding, visitor_group_id, created_at)
     VALUES ($1, $2, $3::vector, $4::vector, $5, now())
     ON CONFLICT (event_id) DO NOTHING`,
    [
      record.eventId,
      record.deviceId,
      toVectorLiteral(record.embedding),
      record.imageEmbedding ? toVectorLiteral(record.imageEmbedding) : null,
      record.visitorGroupId,
    ],
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
