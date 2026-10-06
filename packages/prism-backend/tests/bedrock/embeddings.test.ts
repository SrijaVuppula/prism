import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeModelCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

import {
  BedrockEmbeddingError,
  embedDescription,
  embedImage,
  isImageEmbeddingEnabled,
} from "../../src/bedrock/embeddings";

const ENV = {
  BEDROCK_REGION: "us-east-1",
  BEDROCK_EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
};

function embeddingResponse(embedding: number[]) {
  return { body: new TextEncoder().encode(JSON.stringify({ embedding })) };
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
  delete process.env.BEDROCK_EMBEDDING_DIMENSIONS;
  sendMock.mockReset();
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
  delete process.env.BEDROCK_EMBEDDING_DIMENSIONS;
  delete process.env.BEDROCK_IMAGE_EMBEDDING_MODEL_ID;
  delete process.env.BEDROCK_IMAGE_EMBEDDING_REGION;
});

describe("embedDescription", () => {
  it("sends the description to Bedrock and returns the parsed embedding", async () => {
    sendMock.mockResolvedValue(embeddingResponse([0.1, 0.2, 0.3]));

    const result = await embedDescription("A person waves at the camera.");

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [{ input }] = sendMock.mock.calls[0];
    expect(input.modelId).toBe(ENV.BEDROCK_EMBEDDING_MODEL_ID);
    const body = JSON.parse(input.body);
    expect(body).toEqual({ inputText: "A person waves at the camera.", dimensions: 1024, normalize: true });
  });

  it("honors BEDROCK_EMBEDDING_DIMENSIONS", async () => {
    process.env.BEDROCK_EMBEDDING_DIMENSIONS = "256";
    sendMock.mockResolvedValue(embeddingResponse(new Array(256).fill(0)));

    await embedDescription("A package on the porch.");

    const [{ input }] = sendMock.mock.calls[0];
    expect(JSON.parse(input.body).dimensions).toBe(256);
  });

  it("rejects an empty description without calling Bedrock", async () => {
    await expect(embedDescription("")).rejects.toThrow(BedrockEmbeddingError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws BedrockEmbeddingError when the response has no embedding array", async () => {
    sendMock.mockResolvedValue({ body: new TextEncoder().encode(JSON.stringify({})) });
    await expect(embedDescription("A car in the driveway.")).rejects.toThrow(BedrockEmbeddingError);
  });

  it("wraps a Bedrock call failure", async () => {
    sendMock.mockRejectedValue(new Error("throttled"));
    await expect(embedDescription("A dog in the yard.")).rejects.toThrow(BedrockEmbeddingError);
  });
});

describe("embedImage", () => {
  it("is off, and refuses to run, until an image embedding model is configured", async () => {
    expect(isImageEmbeddingEnabled()).toBe(false);
    await expect(embedImage(Buffer.from([1, 2, 3]))).rejects.toBeInstanceOf(BedrockEmbeddingError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends the image as base64 with a 1024-wide output and returns the embedding", async () => {
    process.env.BEDROCK_IMAGE_EMBEDDING_MODEL_ID = "amazon.titan-embed-image-v1";
    sendMock.mockResolvedValue(embeddingResponse([0.4, 0.5]));

    expect(isImageEmbeddingEnabled()).toBe(true);
    const result = await embedImage(Buffer.from([1, 2, 3]));

    expect(result).toEqual([0.4, 0.5]);
    const command = sendMock.mock.calls[0][0].input;
    expect(command.modelId).toBe("amazon.titan-embed-image-v1");
    expect(JSON.parse(command.body)).toEqual({
      inputImage: Buffer.from([1, 2, 3]).toString("base64"),
      embeddingConfig: { outputEmbeddingLength: 1024 },
    });
  });

  it("wraps a failed call in BedrockEmbeddingError", async () => {
    process.env.BEDROCK_IMAGE_EMBEDDING_MODEL_ID = "amazon.titan-embed-image-v1";
    sendMock.mockRejectedValue(new Error("AccessDeniedException"));

    await expect(embedImage(Buffer.from([1]))).rejects.toBeInstanceOf(BedrockEmbeddingError);
  });

  it("uses BEDROCK_IMAGE_EMBEDDING_REGION when the model is enabled in a different region", async () => {
    process.env.BEDROCK_IMAGE_EMBEDDING_MODEL_ID = "amazon.titan-embed-image-v1";
    process.env.BEDROCK_IMAGE_EMBEDDING_REGION = "us-west-2";
    sendMock.mockResolvedValue(embeddingResponse([0.1]));

    await embedImage(Buffer.from([1]));

    expect(BedrockRuntimeClient).toHaveBeenCalledWith({ region: "us-west-2" });
  });
});
