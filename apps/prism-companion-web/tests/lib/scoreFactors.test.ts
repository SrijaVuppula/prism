import { describe, expect, it } from "vitest";
import { formatContribution, scoreFactors } from "../../src/lib/scoreFactors";

describe("scoreFactors", () => {
  it("labels each factor in plain language, keeping the category base and dropping zero factors", () => {
    const factors = scoreFactors(
      {
        signalScore: 71,
        signalClass: "Urgent",
        breakdown: { categoryBase: 55, confidenceAdjustment: 9, timeOfDay: 15, knownVisitor: 0, repeatVisit: -8 },
      },
      { category: "person", description: "A person at the door.", confidence: 0.93 },
    );

    expect(factors).toEqual([
      { key: "categoryBase", label: "Person detected", value: 55 },
      { key: "confidenceAdjustment", label: "Model confidence (93%)", value: 9 },
      { key: "timeOfDay", label: "Late night or early morning", value: 15 },
      { key: "repeatVisit", label: "Repeat visit", value: -8 },
    ]);
  });

  it("still shows a factor it doesn't recognize, under its own name", () => {
    const factors = scoreFactors({ signalScore: 30, signalClass: "Routine", breakdown: { categoryBase: 25, newFactor: 5 } });
    expect(factors.map((factor) => factor.label)).toEqual(["Subject detected", "newFactor"]);
  });
});

describe("formatContribution", () => {
  it("signs positive and negative contributions", () => {
    expect(formatContribution(15)).toBe("+15");
    expect(formatContribution(-8)).toBe("−8");
    expect(formatContribution(0)).toBe("0");
  });
});
