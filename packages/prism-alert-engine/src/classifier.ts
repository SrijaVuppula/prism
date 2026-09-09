// Wraps the multimodal classification call (Bedrock, Claude multimodal).
// Kept provider-agnostic at the interface level: swap the implementation without
// touching scoring.ts or the channel encoders.
//
// TODO (Phase 2.1): implement the real Bedrock call in prism-backend and have it
// satisfy this interface, or move the actual SDK call here if you want the engine
// package to be fully self-contained. Left as an interface for now since this
// package should stay free of AWS-credential concerns.

import { ClassificationResult } from "./types";

export interface Classifier {
  classify(snapshotUrl: string): Promise<ClassificationResult>;
}

/** Stub classifier for local development/testing without live Bedrock access. */
export class StubClassifier implements Classifier {
  async classify(_snapshotUrl: string): Promise<ClassificationResult> {
    return {
      category: "person",
      description: "A person is standing at the front door.",
      confidence: 0.9,
    };
  }
}
