import { describe, expect, it } from "vitest";
import { buildContextCard } from "../../src/channels/visual";
import type { PrismEvent } from "../../src/types";

function classifiedEvent(overrides: Partial<PrismEvent> = {}): PrismEvent {
  return {
    id: "evt_1",
    occurredAt: "2026-09-17T23:04:00.000Z",
    snapshotUrl: "https://cdn.example.com/snap/evt_1.jpg",
    classification: {
      category: "person",
      description: "A person is standing at the front door.",
      confidence: 0.92,
    },
    scoring: {
      signalScore: 78,
      signalClass: "Urgent",
      breakdown: { categoryBase: 55 },
    },
    ...overrides,
  };
}

describe("buildContextCard", () => {
  it("builds a context card payload from a classified, scored event", () => {
    const card = buildContextCard(classifiedEvent());

    expect(card).toEqual({
      snapshotUrl: "https://cdn.example.com/snap/evt_1.jpg",
      description: "A person is standing at the front door.",
      signalClass: "Urgent",
      timestamp: "2026-09-17T23:04:00.000Z",
    });
  });

  it("throws when the event has not been classified yet", () => {
    const event = classifiedEvent();
    delete event.classification;
    expect(() => buildContextCard(event)).toThrow(/requires a classified and scored event/);
  });

  it("throws when the event has not been scored yet", () => {
    const event = classifiedEvent();
    delete event.scoring;
    expect(() => buildContextCard(event)).toThrow(/requires a classified and scored event/);
  });
});
