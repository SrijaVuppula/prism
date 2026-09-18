import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeModelCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { BedrockEmbeddingError, embedDescription } from "../../src/bedrock/embeddings";

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
