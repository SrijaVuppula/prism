// Bedrock multimodal (Claude) call: snapshot + structured prompt -> classification.
// TODO: implement the real Bedrock Runtime InvokeModel call.
// Measure and log round-trip latency here so the real-time claim is backed
// by a measured number rather than a guess.

import { ClassificationResult } from "prism-alert-engine";

export async function classifySnapshot(_snapshotUrl: string): Promise<ClassificationResult> {
  throw new Error("TODO: implement Bedrock multimodal call");
}
