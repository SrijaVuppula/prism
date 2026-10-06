import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBreakdown } from "../../src/components/ScoreBreakdown";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("ScoreBreakdown", () => {
  it("lists each contributing factor with its signed value and the total, and passes axe", async () => {
    const { container, getByRole, getByText } = render(
      <ScoreBreakdown
        scoring={{ signalScore: 56, signalClass: "Notable", breakdown: { categoryBase: 55, confidenceAdjustment: 9, repeatVisit: -8 } }}
        classification={{ category: "person", description: "A person at the door.", confidence: 0.94 }}
      />,
    );
    expect(getByRole("region", { name: "Why this score" })).toBeInTheDocument();
    expect(getByText("Person detected").nextSibling).toHaveTextContent("+55");
    expect(getByText("Repeat visit").nextSibling).toHaveTextContent("−8");
    expect(getByText("Signal Score").nextSibling).toHaveTextContent("56");
    await expectNoA11yViolations(container);
  });
});
