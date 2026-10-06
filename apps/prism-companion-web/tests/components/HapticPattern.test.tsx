import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HapticPattern } from "../../src/components/HapticPattern";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("HapticPattern", () => {
  it("draws the pattern to scale and describes it in text, and passes axe", async () => {
    const { container, getByRole } = render(<HapticPattern pattern={[300, 150, 300, 150, 300]} signalClass="Urgent" />);
    expect(getByRole("img", { name: "Vibration pattern: 3 pulses of 300 ms, 1.2 s in total" })).toBeInTheDocument();
    const segments = Array.from(container.querySelectorAll<HTMLElement>(".haptic-pattern__bars > span"));
    expect(segments.map((segment) => segment.className)).toEqual([
      "haptic-pattern__pulse",
      "haptic-pattern__pause",
      "haptic-pattern__pulse",
      "haptic-pattern__pause",
      "haptic-pattern__pulse",
    ]);
    expect(segments[1].style.flexGrow).toBe("150");
    await expectNoA11yViolations(container);
  });

  it("describes unequal pulses individually", () => {
    const { getByRole } = render(<HapticPattern pattern={[100, 50, 400]} signalClass="Notable" />);
    expect(getByRole("img")).toHaveAccessibleName("Vibration pattern: 2 pulses (100, 400 ms), 0.6 s in total");
  });

  it("says when an alert has no vibration", () => {
    const { getByText, queryByRole } = render(<HapticPattern signalClass="Routine" />);
    expect(getByText("None. Routine alerts are visual only.")).toBeInTheDocument();
    expect(queryByRole("img")).not.toBeInTheDocument();
  });
});
