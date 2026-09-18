import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignalBadge } from "../../src/components/SignalBadge";
import { expectNoA11yViolations } from "../a11y/axeHelper";
import type { SignalClass } from "prism-alert-engine";

describe("SignalBadge", () => {
  it.each<SignalClass>(["Routine", "Notable", "Urgent"])(
    "renders %s with the class name as visible text (never color alone) and passes axe",
    async (signalClass) => {
      const { container, getByText } = render(<SignalBadge signalClass={signalClass} />);
      expect(getByText(signalClass)).toBeInTheDocument();
      await expectNoA11yViolations(container);
    },
  );

  it("hides the decorative icon from assistive tech", () => {
    const { container } = render(<SignalBadge signalClass="Urgent" />);
    const icon = container.querySelector("[aria-hidden='true']");
    expect(icon).not.toBeNull();
  });
});
