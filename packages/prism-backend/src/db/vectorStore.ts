// pgvector-backed similarity search for repeat-visitor memory.
// Enable the `pgvector` extension in an early migration, even before this
// is wired up, so there's no retrofit migration needed later.

export interface SimilarityMatch {
  eventId: string;
  similarity: number;
}

export async function findSimilarEvent(
  _embedding: number[],
  _sessionWindowId: string,
): Promise<SimilarityMatch | null> {
  throw new Error("TODO: implement pgvector similarity search");
}
