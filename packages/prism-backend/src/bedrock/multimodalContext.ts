// Bedrock multimodal (Claude) call: snapshot + structured prompt -> classification.
// TODO (Phase 2.1 / Spike 3): implement the real Bedrock Runtime InvokeModel call.
// Measure and log round-trip latency here — it feeds the "real-time" claim in
// the submission (Risk Register: report the measured number, don't overclaim).

import { ClassificationResult } from "prism-alert-engine";

export async function classifySnapshot(_snapshotUrl: string): Promise<ClassificationResult> {
  throw new Error("TODO: implement Bedrock multimodal call (Phase 2.1)");
}
