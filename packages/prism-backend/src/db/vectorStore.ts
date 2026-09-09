// pgvector-backed similarity search for repeat-visitor memory (Phase 4.2).
// The `pgvector` extension should be enabled in the Phase 1.3 migration,
// even though it's unused until Phase 4 — no retrofit migration needed later.

export interface SimilarityMatch {
  eventId: string;
  similarity: number;
}

export async function findSimilarEvent(
  _embedding: number[],
  _sessionWindowId: string,
): Promise<SimilarityMatch | null> {
  throw new Error("TODO: implement pgvector similarity search (Phase 4.2)");
}
