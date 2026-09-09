// Bedrock embedding model call for repeat-visitor vector search.
// TODO: generate an embedding for each event's Bedrock-derived description.

export async function embedDescription(_description: string): Promise<number[]> {
  throw new Error("TODO: implement Bedrock embedding call");
}
