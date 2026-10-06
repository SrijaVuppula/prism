import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalMeter } from "../../src/components/SignalMeter";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("SignalMeter", () => {
  it("exposes the score as a meter with the Signal Class in its value text, and passes axe", async () => {
    const { container, getByRole } = render(<SignalMeter score={79} signalClass="Urgent" />);
    const meter = getByRole("meter", { name: "Signal Score" });
    expect(meter).toHaveAttribute("aria-valuenow", "79");
    expect(meter).toHaveAttribute("aria-valuetext", "79 out of 100, Urgent");
    await expectNoA11yViolations(container);
  });

  it("fills each class band only as far as the score reaches", () => {
    const { container } = render(<SignalMeter score={49} signalClass="Notable" />);
    const fills = Array.from(container.querySelectorAll<HTMLElement>(".signal-meter__band-fill")).map(
      (fill) => fill.style.width,
    );
    expect(fills).toEqual(["100%", "40%", "0%"]);
  });

  it("clamps scores outside 0-100", () => {
    const { getByRole } = render(<SignalMeter score={120} signalClass="Urgent" />);
    expect(getByRole("meter")).toHaveAttribute("aria-valuenow", "100");
  });
});
