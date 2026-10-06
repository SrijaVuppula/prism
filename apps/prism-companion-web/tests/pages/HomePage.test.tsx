// Full-page accessibility and keyboard-navigation coverage for the
// companion app's single view (docs/ACCESSIBILITY.md: "all interactive
// elements reachable and operable via keyboard alone"). Real external I/O
// (the WebSocket connection, preference persistence, vibration) is mocked
// at the same hook boundary prism-backend's tests mock AWS/Postgres at --
// everything downstream of those hooks is the real component tree.
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionEventMessage } from "../../src/types";
import { DEFAULT_PREFERENCES } from "../../src/hooks/usePreferences";
import { expectNoA11yViolations } from "../a11y/axeHelper";

const mockUseRealtimeEvents = vi.fn();
const mockUsePreferences = vi.fn();

vi.mock("../../src/hooks/useRealtimeEvents", () => ({
  useRealtimeEvents: () => mockUseRealtimeEvents(),
}));
vi.mock("../../src/hooks/usePreferences", async () => {
  const actual = await vi.importActual<typeof import("../../src/hooks/usePreferences")>(
    "../../src/hooks/usePreferences",
  );
  return { ...actual, usePreferences: () => mockUsePreferences() };
});
vi.mock("../../src/hooks/useVibration", () => ({
  useVibration: vi.fn(),
}));

// Imported after the mocks above so both HomePage and (transitively)
// SettingsPanel pick up the mocked hooks.
const { HomePage } = await import("../../src/pages/HomePage");

function event(id: string, description: string): CompanionEventMessage {
  return {
    type: "prism-event",
    event: { id, occurredAt: "2026-09-18T12:00:00.000Z", snapshotUrl: `https://cdn.example.com/${id}.jpg` },
    channels: {
      visual: {
        snapshotUrl: `https://cdn.example.com/${id}.jpg`,
        description,
        signalClass: "Notable",
        timestamp: "2026-09-18T12:00:00.000Z",
      },
    },
  };
}

describe("HomePage", () => {
  beforeEach(() => {
    mockUsePreferences.mockReturnValue({
      preferences: DEFAULT_PREFERENCES,
      loading: false,
      saveStatus: "idle",
      error: null,
      save: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a role=status waiting message before the first alert arrives, and passes axe", async () => {
    mockUseRealtimeEvents.mockReturnValue({ status: "connecting", events: [], latestEvent: null });
    const { container, getByText } = render(<HomePage />);
    expect(getByText(/waiting for the first alert/i)).toHaveAttribute("role", "status");
    expect(getByText("Card, vibration and push")).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("renders the latest alert live and earlier ones in a list, and passes axe", async () => {
    mockUseRealtimeEvents.mockReturnValue({
      status: "open",
      events: [event("evt_2", "A car in the driveway."), event("evt_1", "A package on the doorstep.")],
      latestEvent: event("evt_2", "A car in the driveway."),
    });
    const { container, getByRole, getByText } = render(<HomePage />);

    expect(getByText("A car in the driveway.")).toBeInTheDocument();
    expect(getByRole("region", { name: /earlier alerts/i })).toBeInTheDocument();
    expect(getByText("A package on the doorstep.")).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it("names the device on the latest and earlier alerts when the message carries one", () => {
    const latest = { ...event("evt_2", "A car in the driveway."), device: { id: "dev_1", name: "Driveway" } };
    const earlier = { ...event("evt_1", "A package on the doorstep."), device: { id: "dev_2", name: "Front Door" } };
    mockUseRealtimeEvents.mockReturnValue({ status: "open", events: [latest, earlier], latestEvent: latest });

    const { getByText } = render(<HomePage />);

    expect(getByText("Driveway")).toBeInTheDocument();
    expect(getByText("Front Door")).toBeInTheDocument();
  });

  it("shows the latest alert's score, breakdown and delivery beside it, and passes axe", async () => {
    const latest = event("evt_3", "A person at the door at night.");
    latest.event.classification = { category: "person", description: "A person at the door at night.", confidence: 0.93 };
    latest.event.scoring = {
      signalScore: 79,
      signalClass: "Urgent",
      breakdown: { categoryBase: 55, confidenceAdjustment: 9, timeOfDay: 15 },
    };
    latest.channels.visual!.signalClass = "Urgent";
    latest.channels.haptic = [300, 150, 300, 150, 300];
    latest.channels.push = { title: "Prism — Urgent", body: "A person at the door at night.", data: {} };
    const earlier = event("evt_1", "A package on the doorstep.");
    mockUseRealtimeEvents.mockReturnValue({ status: "open", events: [latest, earlier], latestEvent: latest });

    const { container, getByRole } = render(<HomePage />);

    const details = getByRole("region", { name: "Alert details" });
    expect(details).toHaveTextContent("Late night or early morning");
    expect(getByRole("meter", { name: "Signal Score" })).toHaveAttribute("aria-valuenow", "79");
    expect(getByRole("img", { name: /vibration pattern: 3 pulses of 300 ms/i })).toBeInTheDocument();
    expect(getByRole("region", { name: "Alert summary" })).toHaveTextContent("1■ Urgent1▲ Notable0● Routine");
    // The live card itself stays concise: the breakdown isn't part of what gets announced.
    expect(container.querySelector("article[aria-live]")).not.toHaveTextContent("Late night or early morning");
    await expectNoA11yViolations(container);
  });

  it("opens Settings from the keyboard and the combined page still passes axe", async () => {
    mockUseRealtimeEvents.mockReturnValue({ status: "open", events: [], latestEvent: null });
    const user = userEvent.setup();
    const { container, findByRole, getByRole } = render(<HomePage />);

    await user.click(getByRole("button", { name: /^settings$/i }));
    await findByRole("group", { name: /quiet hours/i });

    await expectNoA11yViolations(container);
  });

  it("reaches every interactive element by keyboard alone, in order, with no trap", async () => {
    const scoredEvent = event("evt_1", "A person at the door.");
    scoredEvent.event.classification = { category: "person", description: "A person at the door.", confidence: 0.9 };
    scoredEvent.event.scoring = { signalScore: 55, signalClass: "Notable", breakdown: { category: 55 } };
    mockUseRealtimeEvents.mockReturnValue({
      status: "open",
      events: [scoredEvent],
      latestEvent: scoredEvent,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    const user = userEvent.setup();
    const { container } = render(<HomePage />);

    const interactive = Array.from(
      container.querySelectorAll<HTMLElement>("button, input, a[href], [tabindex]:not([tabindex='-1'])"),
    ).filter((el) => !el.hasAttribute("disabled"));
    expect(interactive.length).toBeGreaterThan(0);

    for (let i = 0; i < interactive.length; i += 1) {
      await user.tab();
      expect(interactive).toContain(document.activeElement);
    }
  });
});
