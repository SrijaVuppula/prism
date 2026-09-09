// AgentCore / Strands orchestration chain:
// normalize event -> Bedrock description -> scoring engine -> channel decision -> dispatch.
// TODO (Phase 2.3, Spike 4 in Phase 0.2): pick AgentCore or Strands, stand up the
// minimal two-step chain first to confirm the tool choice, then build this out.
// Document the chain clearly — this feeds the AWS Builder product-feedback answer.

export async function runPipeline(_snapshotUrl: string): Promise<void> {
  throw new Error("TODO: implement orchestration chain (Phase 2.3)");
}
