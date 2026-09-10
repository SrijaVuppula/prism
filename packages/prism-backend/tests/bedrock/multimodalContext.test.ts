import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
  InvokeModelCommand: vi.fn().mockImplementation((input: unknown) => ({ input })),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn() };
});

import { readFile } from "node:fs/promises";
import {
  BedrockClassificationError,
  BedrockClassifier,
  classifySnapshot,
} from "../../src/bedrock/multimodalContext";

const ENV = {
  BEDROCK_REGION: "us-east-1",
  BEDROCK_MODEL_ID: "anthropic.claude-3-5-sonnet-20241022-v2:0",
};

function bedrockResponse(text: string) {
  return { body: new TextEncoder().encode(JSON.stringify({ content: [{ type: "text", text }] })) };
}

function fakeImageFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  });
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
  sendMock.mockReset();
  vi.mocked(readFile).mockReset();
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
  vi.unstubAllGlobals();
});

describe("classifySnapshot", () => {
  it("fetches the snapshot, sends it to Bedrock, and returns a parsed classification", async () => {
    const fetchMock = fakeImageFetch();
    vi.stubGlobal("fetch", fetchMock);
    sendMock.mockResolvedValue(
      bedrockResponse(JSON.stringify({ category: "person", description: "A person waves at the camera.", confidence: 0.87 })),
    );

    const result = await classifySnapshot("https://cdn.ring.com/snap/evt_1.jpg");

    expect(result).toEqual({ category: "person", description: "A person waves at the camera.", confidence: 0.87 });
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.ring.com/snap/evt_1.jpg");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("reads file:// snapshot URLs from disk instead of fetching", async () => {
    const fetchMock = fakeImageFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(readFile).mockResolvedValue(Buffer.from([9, 9, 9]));
    sendMock.mockResolvedValue(
      bedrockResponse(JSON.stringify({ category: "package", description: "A box on the doorstep.", confidence: 0.95 })),
    );

    const result = await classifySnapshot("file:///tmp/fixtures/package.jpg");

    expect(result.category).toBe("package");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("strips a markdown code fence around the JSON reply", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockResolvedValue(
      bedrockResponse('```json\n{"category": "animal", "description": "A dog in the yard.", "confidence": 0.7}\n```'),
    );

    const result = await classifySnapshot("https://cdn.ring.com/snap/evt_2.jpg");
    expect(result.category).toBe("animal");
  });

  it("clamps an out-of-range confidence into 0-1", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockResolvedValue(
      bedrockResponse(JSON.stringify({ category: "vehicle", description: "A car in the driveway.", confidence: 1.4 })),
    );

    const result = await classifySnapshot("https://cdn.ring.com/snap/evt_3.jpg");
    expect(result.confidence).toBe(1);
  });

  it("throws BedrockClassificationError when the snapshot fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(classifySnapshot("https://cdn.ring.com/snap/evt_4.jpg")).rejects.toBeInstanceOf(
      BedrockClassificationError,
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("throws BedrockClassificationError when the snapshot fetch returns non-ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }),
    );
    await expect(classifySnapshot("https://cdn.ring.com/snap/evt_5.jpg")).rejects.toBeInstanceOf(
      BedrockClassificationError,
    );
  });

  it("throws BedrockClassificationError when the Bedrock call itself fails", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockRejectedValue(new Error("throttled"));
    await expect(classifySnapshot("https://cdn.ring.com/snap/evt_6.jpg")).rejects.toBeInstanceOf(
      BedrockClassificationError,
    );
  });

  it("throws BedrockClassificationError on an unrecognized category", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockResolvedValue(
      bedrockResponse(JSON.stringify({ category: "spaceship", description: "?", confidence: 0.5 })),
    );
    await expect(classifySnapshot("https://cdn.ring.com/snap/evt_7.jpg")).rejects.toBeInstanceOf(
      BedrockClassificationError,
    );
  });

  it("throws BedrockClassificationError when the reply has no text content block", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockResolvedValue({ body: new TextEncoder().encode(JSON.stringify({ content: [] })) });
    await expect(classifySnapshot("https://cdn.ring.com/snap/evt_8.jpg")).rejects.toBeInstanceOf(
      BedrockClassificationError,
    );
  });
});

describe("BedrockClassifier", () => {
  it("delegates to classifySnapshot, satisfying the Classifier interface", async () => {
    vi.stubGlobal("fetch", fakeImageFetch());
    sendMock.mockResolvedValue(
      bedrockResponse(JSON.stringify({ category: "person", description: "A person at the door.", confidence: 0.9 })),
    );

    const classifier = new BedrockClassifier();
    const result = await classifier.classify("https://cdn.ring.com/snap/evt_9.jpg");
    expect(result.category).toBe("person");
  });
});
