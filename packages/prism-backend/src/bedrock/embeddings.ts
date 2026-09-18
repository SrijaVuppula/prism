// Bedrock embedding model call for repeat-visitor vector search.
//
// Embeds a Bedrock-derived event description (ClassificationResult.description)
// into a fixed-width vector for cosine similarity search against recent
// events on the same device (see ../db/vectorStore.ts). Same client-caching
// and error-wrapping pattern as multimodalContext.ts's classifySnapshot.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { getBedrockEmbeddingConfig } from "./config";

export class BedrockEmbeddingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BedrockEmbeddingError";
  }
}

let cachedClient: BedrockRuntimeClient | undefined;

function getClient(region: string): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({ region });
  }
  return cachedClient;
}

export async function embedDescription(description: string): Promise<number[]> {
  if (!description || description.trim().length === 0) {
    throw new BedrockEmbeddingError("Cannot embed an empty description");
  }

  const { region, modelId, dimensions } = getBedrockEmbeddingConfig();
  const client = getClient(region);

  const body = JSON.stringify({
    inputText: description,
    dimensions,
    normalize: true,
  });

  const startedAt = Date.now();
  let response: InvokeModelCommandOutput;
  try {
    response = await client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body,
      }),
    );
  } catch (err) {
    throw new BedrockEmbeddingError(`Bedrock InvokeModel embedding call failed for model ${modelId}`, err);
  } finally {
    console.log(`[bedrock] embedDescription model=${modelId} region=${region} latencyMs=${Date.now() - startedAt}`);
  }

  const payload = JSON.parse(Buffer.from(response.body).toString("utf8")) as { embedding?: unknown };
  if (!Array.isArray(payload.embedding) || payload.embedding.some((value) => typeof value !== "number")) {
    throw new BedrockEmbeddingError("Bedrock embedding response did not contain a numeric embedding array");
  }

  return payload.embedding as number[];
}
