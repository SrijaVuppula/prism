// AgentCore / Strands orchestration chain:
// normalize event -> Bedrock description -> scoring engine -> channel decision -> dispatch.
// TODO: pick AgentCore or Strands, stand up a minimal two-step chain first
// to confirm the tool choice, then build this out. Document the chain clearly.

export async function runPipeline(_snapshotUrl: string): Promise<void> {
  throw new Error("TODO: implement orchestration chain");
}
