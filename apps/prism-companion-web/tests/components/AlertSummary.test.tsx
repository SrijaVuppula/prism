import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SignalClass } from "prism-alert-engine";
import { AlertSummary } from "../../src/components/AlertSummary";
import type { CompanionEventMessage } from "../../src/types";
import { expectNoA11yViolations } from "../a11y/axeHelper";

function message(id: string, signalClass: SignalClass): CompanionEventMessage {
  return {
    type: "prism-event",
    event: { id, occurredAt: "2026-01-01T00:00:00Z", snapshotUrl: "x" },
    channels: { visual: { snapshotUrl: "x", description: id, signalClass, timestamp: "2026-01-01T00:00:00Z" } },
  };
}

describe("AlertSummary", () => {
  it("counts alerts by Signal Class, including classes with none, and passes axe", async () => {
    const { container, getAllByRole } = render(
      <AlertSummary events={[message("a", "Notable"), message("b", "Routine"), message("c", "Notable")]} />,
    );
    expect(getAllByRole("listitem").map((item) => item.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "0■ Urgent",
      "2▲ Notable",
      "1● Routine",
    ]);
    await expectNoA11yViolations(container);
  });
});
