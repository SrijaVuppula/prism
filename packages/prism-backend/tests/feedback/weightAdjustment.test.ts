import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_SCORE_WEIGHTS } from "prism-alert-engine";
import {
  computeCategoryFeedbackBias,
  resetSignalScoreWeightsCache,
  resolveSignalScoreWeights,
} from "../../src/feedback/weightAdjustment";

afterEach(() => {
  resetSignalScoreWeightsCache();
});

describe("computeCategoryFeedbackBias", () => {
  it("ignores a category with fewer than the minimum vote count", () => {
    expect(computeCategoryFeedbackBias({ person: { up: 0, down: 2 } })).toEqual({});
  });

  it("biases downward for a consistently downvoted category", () => {
    const bias = computeCategoryFeedbackBias({ vehicle: { up: 0, down: 5 } });
    expect(bias.vehicle).toBeLessThan(0);
  });

  it("biases upward for a consistently upvoted category", () => {
    const bias = computeCategoryFeedbackBias({ package: { up: 5, down: 0 } });
    expect(bias.package).toBeGreaterThan(0);
  });

  it("caps the magnitude of the bias", () => {
    const bias = computeCategoryFeedbackBias({ person: { up: 0, down: 1000 } });
    expect(bias.person).toBe(-15);
  });

  it("omits a category whose net feedback is exactly balanced", () => {
    const bias = computeCategoryFeedbackBias({ animal: { up: 3, down: 3 } });
    expect(bias.animal).toBeUndefined();
  });
});

describe("resolveSignalScoreWeights", () => {
  it("merges the feedback-derived bias into the default weights", async () => {
    const store = { getCategoryTally: vi.fn().mockResolvedValue({ vehicle: { up: 0, down: 5 } }) };

    const weights = await resolveSignalScoreWeights(store);

    expect(weights.categoryBase).toEqual(DEFAULT_SIGNAL_SCORE_WEIGHTS.categoryBase);
    expect(weights.categoryFeedbackBias.vehicle).toBeLessThan(0);
  });

  it("caches the resolved weights rather than re-querying every call", async () => {
    const store = { getCategoryTally: vi.fn().mockResolvedValue({}) };

    await resolveSignalScoreWeights(store);
    await resolveSignalScoreWeights(store);

    expect(store.getCategoryTally).toHaveBeenCalledTimes(1);
  });
});
