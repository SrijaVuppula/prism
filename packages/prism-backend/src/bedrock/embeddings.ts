// Bedrock embedding model calls for repeat-visitor vector search.
//
// embedDescription() embeds text Bedrock produced about an event (the
// visitor signature, or the description when there is none) into a
// fixed-width vector; embedImage() optionally embeds the snapshot itself.
// Both are compared against recent events on the same device (see
// ../db/vectorStore.ts). Same client-caching and error-wrapping pattern as
// multimodalContext.ts's classifySnapshot.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { getBedrockEmbeddingConfig, getBedrockImageEmbeddingConfig } from "./config";

export class BedrockEmbeddingError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BedrockEmbeddingError";
  }
}

// One client per region: the image embedding model may be configured in a
// different region from the text one.
const clients = new Map<string, BedrockRuntimeClient>();

function getClient(region: string): BedrockRuntimeClient {
  let client = clients.get(region);
  if (!client) {
    client = new BedrockRuntimeClient({ region });
    clients.set(region, client);
  }
  return client;
}

function parseEmbedding(response: InvokeModelCommandOutput): number[] {
  const payload = JSON.parse(Buffer.from(response.body).toString("utf8")) as { embedding?: unknown };
  if (!Array.isArray(payload.embedding) || payload.embedding.some((value) => typeof value !== "number")) {
    throw new BedrockEmbeddingError("Bedrock embedding response did not contain a numeric embedding array");
  }
  return payload.embedding as number[];
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

  return parseEmbedding(response);
}

/** True when an image embedding model is configured (BEDROCK_IMAGE_EMBEDDING_MODEL_ID). */
export function isImageEmbeddingEnabled(): boolean {
  return getBedrockImageEmbeddingConfig() !== null;
}

/**
 * Embeds snapshot image bytes with the configured multimodal embedding
 * model (Amazon Titan Multimodal Embeddings request shape). Throws if no
 * image embedding model is configured -- check isImageEmbeddingEnabled().
 */
export async function embedImage(imageBytes: Buffer): Promise<number[]> {
  const config = getBedrockImageEmbeddingConfig();
  if (!config) {
    throw new BedrockEmbeddingError("No image embedding model is configured (BEDROCK_IMAGE_EMBEDDING_MODEL_ID)");
  }
  if (imageBytes.length === 0) {
    throw new BedrockEmbeddingError("Cannot embed an empty image");
  }

  const { region, modelId, dimensions } = config;
  const body = JSON.stringify({
    inputImage: imageBytes.toString("base64"),
    embeddingConfig: { outputEmbeddingLength: dimensions },
  });

  const startedAt = Date.now();
  let response: InvokeModelCommandOutput;
  try {
    response = await getClient(region).send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body,
      }),
    );
  } catch (err) {
    throw new BedrockEmbeddingError(`Bedrock InvokeModel image embedding call failed for model ${modelId}`, err);
  } finally {
    console.log(`[bedrock] embedImage model=${modelId} region=${region} latencyMs=${Date.now() - startedAt}`);
  }

  return parseEmbedding(response);
}
