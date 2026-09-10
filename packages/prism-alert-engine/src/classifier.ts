// Wraps the multimodal classification call (Bedrock, Claude multimodal).
// Kept provider-agnostic at the interface level: swap the implementation without
// touching scoring.ts or the channel encoders.
//
// The real implementation lives in prism-backend/src/bedrock/multimodalContext.ts
// (BedrockClassifier), which satisfies this interface. Kept as an interface
// here so this package stays free of AWS-credential concerns.

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
