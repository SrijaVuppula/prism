import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismEvent } from "prism-alert-engine";
import { DEFAULT_SIGNAL_SCORE_WEIGHTS } from "prism-alert-engine";

vi.mock("../../src/bedrock/multimodalContext", () => ({
  classifySnapshot: vi.fn(),
}));
vi.mock("../../src/api/websocket", () => ({
  broadcastEvent: vi.fn(),
}));
vi.mock("../../src/push/dispatchPush", () => ({
  dispatchPushNotifications: vi.fn(),
}));
vi.mock("../../src/preferences/preferencesStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/preferences/preferencesStore")>();
  return { ...actual, getPreferencesStore: vi.fn() };
});
vi.mock("../../src/feedback/weightAdjustment", () => ({
  resolveSignalScoreWeights: vi.fn(),
}));
vi.mock("../../src/bedrock/repeatVisitorMemory", () => ({
  resolveRepeatVisitor: vi.fn(),
}));

import { classifySnapshot } from "../../src/bedrock/multimodalContext";
import { broadcastEvent } from "../../src/api/websocket";
import { dispatchPushNotifications } from "../../src/push/dispatchPush";
import { getPreferencesStore, DEFAULT_PREFERENCES } from "../../src/preferences/preferencesStore";
import { resolveSignalScoreWeights } from "../../src/feedback/weightAdjustment";
import { resolveRepeatVisitor } from "../../src/bedrock/repeatVisitorMemory";
import { DEFAULT_ORCHESTRATION_CONTEXT, runPipeline } from "../../src/bedrock/agentOrchestration";

function baseEvent(occurredAt: string): PrismEvent {
  return {
    id: "evt_1",
    occurredAt,
    snapshotUrl: "https://cdn.ring.com/snap/evt_1.jpg",
  };
}

beforeEach(() => {
  vi.mocked(classifySnapshot).mockReset();
  vi.mocked(broadcastEvent).mockReset();
  vi.mocked(dispatchPushNotifications).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPreferencesStore).mockReset().mockReturnValue({
    get: vi.fn().mockResolvedValue(DEFAULT_PREFERENCES),
    save: vi.fn(),
  } as never);
  vi.mocked(resolveSignalScoreWeights).mockReset().mockResolvedValue(DEFAULT_SIGNAL_SCORE_WEIGHTS);
  vi.mocked(resolveRepeatVisitor)
    .mockReset()
    .mockResolvedValue({ repeatVisitCount: 0, isKnownVisitor: false, visitorGroupId: "group_1" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runPipeline", () => {
  it("classifies, scores, and produces all three channel payloads for an Urgent event", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door late at night.",
      confidence: 0.95,
    });

    // 23:00 UTC -- off-hours, so scoring should land Urgent for a
    // high-confidence, unknown, non-repeat person detection.
    const result = await runPipeline(baseEvent("2026-01-01T23:00:00.000Z"));

    expect(result.event.classification?.category).toBe("person");
    expect(result.event.scoring?.signalClass).toBe("Urgent");
    expect(result.channels.visual).toBeDefined();
    expect(result.channels.haptic).toBeDefined();
    expect(result.channels.push).toBeDefined();
    expect(result.channels.visual?.description).toBe("A person at the door late at night.");
    expect(result.channels.push?.data.eventId).toBe("evt_1");
  });

  it("produces only a visual payload for a Routine event", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "animal",
      description: "A squirrel in the yard.",
      confidence: 0.8,
    });

    // 14:00 UTC -- daytime, animal base weight is low, so this should stay Routine.
    const result = await runPipeline(baseEvent("2026-01-01T14:00:00.000Z"));

    expect(result.event.scoring?.signalClass).toBe("Routine");
    expect(result.channels.visual).toBeDefined();
    expect(result.channels.haptic).toBeUndefined();
    expect(result.channels.push).toBeUndefined();
  });

  it("de-escalates toward Routine for a known, repeat visitor even at high confidence", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "The same person as earlier today.",
      confidence: 0.9,
    });

    const result = await runPipeline(baseEvent("2026-01-01T14:00:00.000Z"), {
      isKnownVisitor: true,
      repeatVisitCount: 3,
      isQuietHours: false,
    });

    expect(result.event.scoring?.signalClass).toBe("Routine");
    expect(result.channels.haptic).toBeUndefined();
  });

  it("uses UTC hours to derive hourOfDay, independent of the process's local timezone", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door.",
      confidence: 0.9,
    });

    await runPipeline(baseEvent("2026-01-01T02:30:00.000Z"), DEFAULT_ORCHESTRATION_CONTEXT);

    // computeSignalScore only receives the derived ScoringInput, not the raw
    // timestamp, so we assert indirectly: 02:30 UTC is off-hours and should
    // therefore score Urgent for an unknown person at default confidence.
    const result = await runPipeline(baseEvent("2026-01-01T02:30:00.000Z"), DEFAULT_ORCHESTRATION_CONTEXT);
    expect(result.event.scoring?.signalClass).toBe("Urgent");
  });

  it("propagates a classification failure instead of swallowing it", async () => {
    vi.mocked(classifySnapshot).mockRejectedValue(new Error("bedrock unavailable"));
    await expect(runPipeline(baseEvent("2026-01-01T14:00:00.000Z"))).rejects.toThrow("bedrock unavailable");
  });

  it("broadcasts the scored event over WebSocket and dispatches push for an Urgent event", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door late at night.",
      confidence: 0.95,
    });

    const result = await runPipeline(baseEvent("2026-01-01T23:00:00.000Z"));

    expect(broadcastEvent).toHaveBeenCalledTimes(1);
    expect(broadcastEvent).toHaveBeenCalledWith({
      type: "prism-event",
      event: result.event,
      channels: result.channels,
    });
    expect(dispatchPushNotifications).toHaveBeenCalledTimes(1);
    expect(dispatchPushNotifications).toHaveBeenCalledWith(result.channels.push);
  });

  it("broadcasts over WebSocket but skips push dispatch for a Routine event", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "animal",
      description: "A squirrel in the yard.",
      confidence: 0.8,
    });

    await runPipeline(baseEvent("2026-01-01T14:00:00.000Z"));

    expect(broadcastEvent).toHaveBeenCalledTimes(1);
    expect(dispatchPushNotifications).not.toHaveBeenCalled();
  });

  it("still returns the pipeline result when the WebSocket broadcast throws", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "animal",
      description: "A squirrel in the yard.",
      confidence: 0.8,
    });
    vi.mocked(broadcastEvent).mockImplementation(() => {
      throw new Error("no server attached");
    });

    const result = await runPipeline(baseEvent("2026-01-01T14:00:00.000Z"));
    expect(result.event.scoring?.signalClass).toBe("Routine");
  });

  it("does not look up repeat-visitor memory when the event has no deviceId", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door.",
      confidence: 0.9,
    });

    await runPipeline(baseEvent("2026-01-01T14:00:00.000Z"));

    expect(resolveRepeatVisitor).not.toHaveBeenCalled();
  });

  it("resolves real repeat-visitor context and known-visitor tagging when the event has a deviceId", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "The mail carrier again.",
      confidence: 0.9,
    });
    vi.mocked(resolveRepeatVisitor).mockResolvedValue({
      repeatVisitCount: 2,
      isKnownVisitor: true,
      visitorGroupId: "group_mail_carrier",
    });

    const result = await runPipeline({ ...baseEvent("2026-01-01T14:00:00.000Z"), deviceId: "dev_1" });

    expect(resolveRepeatVisitor).toHaveBeenCalledTimes(1);
    expect(result.event.visitorGroupId).toBe("group_mail_carrier");
    expect(result.event.scoring?.signalClass).toBe("Routine");
  });

  it("applies per-signal-class haptic overrides from preferences", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door late at night.",
      confidence: 0.95,
    });
    vi.mocked(getPreferencesStore).mockReturnValue({
      get: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, hapticOverrides: { Urgent: [1, 2, 3] } }),
      save: vi.fn(),
    } as never);

    const result = await runPipeline(baseEvent("2026-01-01T23:00:00.000Z"));

    expect(result.channels.haptic).toEqual([1, 2, 3]);
  });

  it("falls back to default scoring weights when the feedback loop fails", async () => {
    vi.mocked(classifySnapshot).mockResolvedValue({
      category: "person",
      description: "A person at the door late at night.",
      confidence: 0.95,
    });
    vi.mocked(resolveSignalScoreWeights).mockRejectedValue(new Error("db unavailable"));

    const result = await runPipeline(baseEvent("2026-01-01T23:00:00.000Z"));

    expect(result.event.scoring?.signalClass).toBe("Urgent");
  });
});
