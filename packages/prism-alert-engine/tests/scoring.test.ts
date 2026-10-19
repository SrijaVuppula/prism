import { describe, expect, it } from "vitest";
import { computeSignalScore } from "../src/scoring";

describe("computeSignalScore", () => {
  it("scores a high-confidence late-night unknown person as Urgent", () => {
    const result = computeSignalScore({
      category: "person",
      confidence: 0.95,
      hourOfDay: 23,
      isKnownVisitor: false,
      repeatVisitCount: 0,
      isQuietHours: false,
    });
    expect(result.signalClass).toBe("Urgent");
  });

  it("never lowers a person during quiet hours, so a late-night visitor stays Urgent", () => {
    const result = computeSignalScore({
      category: "person",
      confidence: 0.95,
      hourOfDay: 23,
      isKnownVisitor: false,
      repeatVisitCount: 0,
      isQuietHours: true,
    });
    expect(result.breakdown.quietHours).toBe(0);
    expect(result.signalScore).toBe(79); // person 55 + confidence 9 + late night 15
    expect(result.signalClass).toBe("Urgent");
  });

  it("still lowers packages, vehicles and animals during quiet hours", () => {
    for (const category of ["package", "vehicle", "animal"] as const) {
      const input = { category, confidence: 0.9, hourOfDay: 23, isKnownVisitor: false, repeatVisitCount: 0 };
      const quiet = computeSignalScore({ ...input, isQuietHours: true });
      const normal = computeSignalScore({ ...input, isQuietHours: false });
      expect(quiet.breakdown.quietHours).toBe(-10);
      expect(quiet.signalScore).toBe(normal.signalScore - 10);
    }
  });

  it("de-escalates a known repeat visitor toward Routine", () => {
    const result = computeSignalScore({
      category: "person",
      confidence: 0.9,
      hourOfDay: 14,
      isKnownVisitor: true,
      repeatVisitCount: 3,
      isQuietHours: false,
    });
    expect(result.signalScore).toBeLessThan(35);
    expect(result.signalClass).toBe("Routine");
  });

  it("scores an animal detection during the day as Routine", () => {
    const result = computeSignalScore({
      category: "animal",
      confidence: 0.8,
      hourOfDay: 12,
      isKnownVisitor: false,
      repeatVisitCount: 0,
      isQuietHours: false,
    });
    expect(result.signalClass).toBe("Routine");
  });

  it("never produces a score outside 0-100", () => {
    const result = computeSignalScore({
      category: "person",
      confidence: 1,
      hourOfDay: 2,
      isKnownVisitor: false,
      repeatVisitCount: 0,
      isQuietHours: false,
    });
    expect(result.signalScore).toBeGreaterThanOrEqual(0);
    expect(result.signalScore).toBeLessThanOrEqual(100);
  });
});
