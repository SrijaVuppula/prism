import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismEvent } from "prism-alert-engine";

vi.mock("../../src/bedrock/embeddings", () => ({
  embedDescription: vi.fn(),
  embedImage: vi.fn(),
  isImageEmbeddingEnabled: vi.fn(),
}));
vi.mock("../../src/bedrock/multimodalContext", () => ({
  loadSnapshotBytes: vi.fn(),
}));
vi.mock("../../src/db/vectorStore", () => ({
  findSimilarEvent: vi.fn(),
  recordEventEmbedding: vi.fn(),
  countVisitorGroupOccurrences: vi.fn(),
  getSessionWindowMs: vi.fn().mockReturnValue(45 * 60_000),
}));
vi.mock("../../src/db/knownVisitorTagStore", () => ({
  getKnownVisitorTagStore: vi.fn(),
}));

import { embedDescription, embedImage, isImageEmbeddingEnabled } from "../../src/bedrock/embeddings";
import { loadSnapshotBytes } from "../../src/bedrock/multimodalContext";
import { countVisitorGroupOccurrences, findSimilarEvent, recordEventEmbedding } from "../../src/db/vectorStore";
import { getKnownVisitorTagStore } from "../../src/db/knownVisitorTagStore";
import { resolveRepeatVisitor } from "../../src/bedrock/repeatVisitorMemory";

const classification = { category: "person" as const, description: "A person at the door.", confidence: 0.9 };

function event(overrides: Partial<PrismEvent> = {}): PrismEvent {
  return {
    id: "evt_1",
    occurredAt: "2026-01-01T12:00:00.000Z",
    snapshotUrl: "https://cdn.ring.com/snap/evt_1.jpg",
    ...overrides,
  };
}

const match = {
  eventId: "evt_prior",
  visitorGroupId: "group_1",
  similarity: 0.95,
  textSimilarity: 0.95,
  imageSimilarity: null,
  matchedBy: "text" as const,
};

beforeEach(() => {
  vi.mocked(embedDescription).mockReset().mockResolvedValue([0.1, 0.2]);
  vi.mocked(isImageEmbeddingEnabled).mockReset().mockReturnValue(false);
  vi.mocked(embedImage).mockReset().mockResolvedValue([0.7, 0.8]);
  vi.mocked(loadSnapshotBytes).mockReset().mockResolvedValue({ bytes: Buffer.from([1, 2, 3]), mediaType: "image/jpeg" });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(findSimilarEvent).mockReset();
  vi.mocked(recordEventEmbedding).mockReset().mockResolvedValue(undefined);
  vi.mocked(countVisitorGroupOccurrences).mockReset();
  vi.mocked(getKnownVisitorTagStore).mockReset();
});

describe("resolveRepeatVisitor", () => {
  it("returns a first-time-visit result without any DB lookups when the event has no deviceId", async () => {
    const result = await resolveRepeatVisitor(event(), classification, true);

    expect(result.repeatVisitCount).toBe(0);
    expect(result.isKnownVisitor).toBe(false);
    expect(result.visitorGroupId).toBeTruthy();
    expect(embedDescription).not.toHaveBeenCalled();
  });

  it("mints a new visitor group and records the embedding when there is no similar prior event", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(null);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(result.repeatVisitCount).toBe(0);
    expect(result.isKnownVisitor).toBe(false);
    expect(recordEventEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "evt_1", deviceId: "dev_1", visitorGroupId: result.visitorGroupId }),
    );
  });

  it("inherits the matched visitor group and counts occurrences on a repeat visit", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(match);
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(2);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(result.visitorGroupId).toBe("group_1");
    expect(result.repeatVisitCount).toBe(2);
    expect(result.isKnownVisitor).toBe(false);
    // The count leaves out this event, which was just recorded in the group.
    expect(countVisitorGroupOccurrences).toHaveBeenCalledWith("group_1", "dev_1", expect.any(Date), "evt_1");
  });

  it("does not consult known-visitor tags when tagging is disabled, even on a match", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(match);
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);

    await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(getKnownVisitorTagStore).not.toHaveBeenCalled();
  });

  it("marks a matched visitor group known when tagging is enabled and a tag exists", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(match);
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);
    vi.mocked(getKnownVisitorTagStore).mockReturnValue({
      find: vi.fn().mockResolvedValue({ visitorGroupId: "group_1", label: "Mail carrier" }),
    } as never);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, true);

    expect(result.isKnownVisitor).toBe(true);
  });

  it("leaves isKnownVisitor false when tagging is enabled but no tag exists for the group", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(match);
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);
    vi.mocked(getKnownVisitorTagStore).mockReturnValue({ find: vi.fn().mockResolvedValue(null) } as never);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, true);

    expect(result.isKnownVisitor).toBe(false);
  });

  it("matches on the visitor signature when the classification has one, else on the description", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(null);

    await resolveRepeatVisitor(
      event({ deviceId: "dev_1" }),
      { ...classification, visitorSignature: "red cap, red jacket, black gloves" },
      false,
    );
    expect(embedDescription).toHaveBeenLastCalledWith("red cap, red jacket, black gloves");

    await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);
    expect(embedDescription).toHaveBeenLastCalledWith("A person at the door.");
  });

  it("leaves image matching off unless an image embedding model is configured", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue(null);

    await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(loadSnapshotBytes).not.toHaveBeenCalled();
    expect(embedImage).not.toHaveBeenCalled();
    expect(findSimilarEvent).toHaveBeenCalledWith({ text: [0.1, 0.2], image: undefined }, "dev_1", expect.any(Date));
  });

  it("embeds the snapshot and matches and records on both signals when image embeddings are on", async () => {
    vi.mocked(isImageEmbeddingEnabled).mockReturnValue(true);
    vi.mocked(findSimilarEvent).mockResolvedValue(null);

    await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(loadSnapshotBytes).toHaveBeenCalledWith("https://cdn.ring.com/snap/evt_1.jpg");
    expect(embedImage).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(findSimilarEvent).toHaveBeenCalledWith({ text: [0.1, 0.2], image: [0.7, 0.8] }, "dev_1", expect.any(Date));
    expect(recordEventEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: [0.1, 0.2], imageEmbedding: [0.7, 0.8] }),
    );
  });

  it("falls back to text-only matching when the image embedding fails", async () => {
    vi.mocked(isImageEmbeddingEnabled).mockReturnValue(true);
    vi.mocked(embedImage).mockRejectedValue(new Error("model not enabled in this region"));
    vi.mocked(findSimilarEvent).mockResolvedValue(match);
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(findSimilarEvent).toHaveBeenCalledWith({ text: [0.1, 0.2], image: undefined }, "dev_1", expect.any(Date));
    expect(result.repeatVisitCount).toBe(1);
    expect(console.error).toHaveBeenCalled();
  });
});
