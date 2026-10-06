import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextCard, formatTimestamp } from "../../src/components/ContextCard";
import { expectNoA11yViolations } from "../a11y/axeHelper";
import type { ContextCardPayload, PrismEvent } from "prism-alert-engine";

const card: ContextCardPayload = {
  snapshotUrl: "https://cdn.example.com/snap.jpg",
  description: "A person is standing at the front door.",
  signalClass: "Notable",
  timestamp: "2026-09-18T12:00:00.000Z",
};

const baseEvent: PrismEvent = {
  id: "evt_1",
  occurredAt: "2026-09-18T12:00:00.000Z",
  snapshotUrl: card.snapshotUrl,
};

describe("ContextCard", () => {
  it("gives the snapshot a real, non-empty alt description and passes axe", async () => {
    const { container, getByAltText } = render(<ContextCard card={card} event={baseEvent} />);
    expect(getByAltText(card.description)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("loads the snapshot through the backend rather than the raw snapshot URL", () => {
    const fileEvent: PrismEvent = { ...baseEvent, id: "evt/1", snapshotUrl: "file:///fixtures/person.jpg" };
    const { getByAltText } = render(<ContextCard card={{ ...card, snapshotUrl: fileEvent.snapshotUrl }} event={fileEvent} />);
    expect(getByAltText(card.description)).toHaveAttribute("src", "/events/evt%2F1/snapshot");
  });

  it("drops the image instead of showing a broken one when the snapshot fails to load", () => {
    const { getByAltText, queryByAltText, getByText } = render(<ContextCard card={card} event={baseEvent} />);
    fireEvent.error(getByAltText(card.description));
    expect(queryByAltText(card.description)).not.toBeInTheDocument();
    expect(getByText(card.description)).toBeInTheDocument();
  });

  it("shows the next alert's snapshot even after the previous one failed to load", () => {
    const { getByAltText, queryByAltText, rerender } = render(<ContextCard card={card} event={baseEvent} live />);
    fireEvent.error(getByAltText(card.description));
    expect(queryByAltText(card.description)).not.toBeInTheDocument();

    const nextCard = { ...card, description: "A package on the doorstep." };
    rerender(<ContextCard card={nextCard} event={{ ...baseEvent, id: "evt_2" }} live />);
    expect(getByAltText(nextCard.description)).toHaveAttribute("src", "/events/evt_2/snapshot");
  });

  it("shows the subject and, in the compact variant, the Signal Score, and passes axe", async () => {
    const scoredEvent: PrismEvent = {
      ...baseEvent,
      classification: { category: "package", description: card.description, confidence: 0.96 },
      scoring: { signalScore: 49, signalClass: "Notable", breakdown: { categoryBase: 40, confidenceAdjustment: 9 } },
    };
    const { container, getByText } = render(<ContextCard card={card} event={scoredEvent} variant="compact" />);
    expect(getByText("Package · 96% confidence")).toBeInTheDocument();
    expect(getByText("Signal Score 49")).toBeInTheDocument();
    expect(container.querySelector("article")).toHaveClass("context-card--compact", "context-card--notable");
    await expectNoA11yViolations(container);
  });

  it("names the device the alert came from ahead of the subject", () => {
    const scoredEvent: PrismEvent = {
      ...baseEvent,
      deviceId: "dev_1",
      classification: { category: "person", description: card.description, confidence: 0.95 },
    };
    const { getByText } = render(<ContextCard card={card} event={scoredEvent} deviceName="Front Door" />);
    expect(getByText("Front Door · Person · 95% confidence")).toBeInTheDocument();
  });

  it("marks only the live card assertive so new alerts are announced", () => {
    const { container: liveContainer } = render(<ContextCard card={card} event={baseEvent} live />);
    expect(liveContainer.querySelector("article")).toHaveAttribute("aria-live", "assertive");

    const { container: historyContainer } = render(<ContextCard card={card} event={baseEvent} />);
    expect(historyContainer.querySelector("article")).not.toHaveAttribute("aria-live");
  });

  it("shows feedback controls once classification and scoring are present, and still passes axe", async () => {
    const scoredEvent: PrismEvent = {
      ...baseEvent,
      classification: { category: "person", description: card.description, confidence: 0.9 },
      scoring: { signalScore: 55, signalClass: "Notable", breakdown: { category: 55 } },
    };
    const { container, getByRole } = render(<ContextCard card={card} event={scoredEvent} />);
    expect(getByRole("group", { name: /was this alert helpful/i })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("only offers visitor tagging when the household opted in and the event has a visitor group", async () => {
    const groupedEvent: PrismEvent = { ...baseEvent, visitorGroupId: "grp_1" };

    const { queryByRole: withoutOptIn } = render(
      <ContextCard card={card} event={groupedEvent} knownVisitorTaggingEnabled={false} />,
    );
    expect(withoutOptIn("button", { name: /recognize this visitor/i })).not.toBeInTheDocument();

    const { container, getByRole } = render(
      <ContextCard card={card} event={groupedEvent} knownVisitorTaggingEnabled />,
    );
    expect(getByRole("button", { name: /recognize this visitor/i })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe("formatTimestamp", () => {
  it("shows the time and zone in the household's time zone", () => {
    const text = formatTimestamp("2026-09-18T12:00:00.000Z", "America/New_York");
    expect(text).toMatch(/8:00/);
    expect(text).toMatch(/EDT/);
  });

  it("falls back to this device's zone for an unrecognized zone name", () => {
    expect(() => formatTimestamp("2026-09-18T12:00:00.000Z", "Not/AZone")).not.toThrow();
  });
});
