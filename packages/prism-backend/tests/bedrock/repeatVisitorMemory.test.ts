import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismEvent } from "prism-alert-engine";

vi.mock("../../src/bedrock/embeddings", () => ({
  embedDescription: vi.fn(),
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

import { embedDescription } from "../../src/bedrock/embeddings";
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

beforeEach(() => {
  vi.mocked(embedDescription).mockReset().mockResolvedValue([0.1, 0.2]);
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
    vi.mocked(findSimilarEvent).mockResolvedValue({
      eventId: "evt_prior",
      visitorGroupId: "group_1",
      similarity: 0.95,
    });
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(2);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(result.visitorGroupId).toBe("group_1");
    expect(result.repeatVisitCount).toBe(2);
    expect(result.isKnownVisitor).toBe(false);
  });

  it("does not consult known-visitor tags when tagging is disabled, even on a match", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue({ eventId: "evt_prior", visitorGroupId: "group_1", similarity: 0.95 });
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);

    await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, false);

    expect(getKnownVisitorTagStore).not.toHaveBeenCalled();
  });

  it("marks a matched visitor group known when tagging is enabled and a tag exists", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue({ eventId: "evt_prior", visitorGroupId: "group_1", similarity: 0.95 });
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);
    vi.mocked(getKnownVisitorTagStore).mockReturnValue({
      find: vi.fn().mockResolvedValue({ visitorGroupId: "group_1", label: "Mail carrier" }),
    } as never);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, true);

    expect(result.isKnownVisitor).toBe(true);
  });

  it("leaves isKnownVisitor false when tagging is enabled but no tag exists for the group", async () => {
    vi.mocked(findSimilarEvent).mockResolvedValue({ eventId: "evt_prior", visitorGroupId: "group_1", similarity: 0.95 });
    vi.mocked(countVisitorGroupOccurrences).mockResolvedValue(1);
    vi.mocked(getKnownVisitorTagStore).mockReturnValue({ find: vi.fn().mockResolvedValue(null) } as never);

    const result = await resolveRepeatVisitor(event({ deviceId: "dev_1" }), classification, true);

    expect(result.isKnownVisitor).toBe(false);
  });
});
