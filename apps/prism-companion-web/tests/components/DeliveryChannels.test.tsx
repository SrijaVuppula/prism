import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryChannels } from "../../src/components/DeliveryChannels";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("DeliveryChannels", () => {
  it("states in text which channels were sent, and passes axe", async () => {
    const { container, getAllByRole } = render(
      <DeliveryChannels
        channels={{
          visual: { snapshotUrl: "x", description: "d", signalClass: "Notable", timestamp: "2026-01-01T00:00:00Z" },
          haptic: [150, 100, 150],
        }}
      />,
    );
    expect(getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "✓Card: sent",
      "✓Vibration: sent",
      "–Push: not sent",
    ]);
    await expectNoA11yViolations(container);
  });
});
