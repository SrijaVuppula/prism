import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackButtons } from "../../src/components/FeedbackButtons";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("FeedbackButtons", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes vote state via aria-pressed, not color/icon alone, and passes axe", async () => {
    const user = userEvent.setup();
    const { container, getByRole } = render(
      <FeedbackButtons eventId="evt_1" category="person" signalClass="Notable" signalScore={50} />,
    );

    const helpful = getByRole("button", { name: /^helpful$/i });
    expect(helpful).toHaveAttribute("aria-pressed", "false");

    await user.click(helpful);
    await waitFor(() => expect(helpful).toHaveAttribute("aria-pressed", "true"));

    await expectNoA11yViolations(container);
  });

  it("disables both buttons while a vote is in flight so it can't be double-submitted", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(new Promise<Response>((resolve) => (resolveFetch = resolve))),
    );
    const user = userEvent.setup();
    const { getByRole } = render(
      <FeedbackButtons eventId="evt_2" category="package" signalClass="Routine" signalScore={10} />,
    );

    const helpful = getByRole("button", { name: /^helpful$/i });
    const notHelpful = getByRole("button", { name: /^not helpful$/i });
    await user.click(helpful);

    expect(helpful).toBeDisabled();
    expect(notHelpful).toBeDisabled();

    resolveFetch({ ok: true, json: async () => ({}) } as Response);
    await waitFor(() => expect(helpful).not.toBeDisabled());
  });
});
