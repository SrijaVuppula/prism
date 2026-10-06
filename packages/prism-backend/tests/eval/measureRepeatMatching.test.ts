import { describe, expect, it } from "vitest";
import { cosineSimilarity, separation } from "../../eval/measureRepeatMatching";

describe("cosineSimilarity", () => {
  it("is 1 for parallel vectors, 0 for orthogonal ones, regardless of length", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 5])).toBeCloseTo(0);
  });
});

describe("separation", () => {
  it("suggests the midpoint when same-visitor pairs all score above different-visitor pairs", () => {
    expect(separation([0.93, 0.97], [0.6, 0.81])).toMatchObject({
      sameMin: 0.93,
      differentMax: 0.81,
      suggestedThreshold: 0.87,
    });
  });

  it("suggests nothing when the groups overlap", () => {
    expect(separation([0.8, 0.95], [0.85, 0.5]).suggestedThreshold).toBeNull();
  });
});
