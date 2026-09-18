import { describe, expect, it } from "vitest";
import { buildPushPayload } from "../../src/channels/push";
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

describe("buildPushPayload", () => {
  it("builds a push payload from a classified, scored event", () => {
    const payload = buildPushPayload(classifiedEvent());

    expect(payload).toEqual({
      title: "Prism — Urgent",
      body: "A person is standing at the front door.",
      data: {
        eventId: "evt_1",
        signalClass: "Urgent",
        snapshotUrl: "https://cdn.example.com/snap/evt_1.jpg",
      },
    });
  });

  it("throws when the event has not been classified yet", () => {
    const event = classifiedEvent();
    delete event.classification;
    expect(() => buildPushPayload(event)).toThrow(/requires a classified and scored event/);
  });

  it("throws when the event has not been scored yet", () => {
    const event = classifiedEvent();
    delete event.scoring;
    expect(() => buildPushPayload(event)).toThrow(/requires a classified and scored event/);
  });
});
