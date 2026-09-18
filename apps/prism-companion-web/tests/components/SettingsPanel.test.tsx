import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { DEFAULT_PREFERENCES } from "../../src/hooks/usePreferences";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("SettingsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => DEFAULT_PREFERENCES } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("groups each preference section under a fieldset/legend and passes axe", async () => {
    const { container, findByRole } = render(<SettingsPanel onClose={() => {}} />);

    // Wait for the initial preferences fetch to resolve past the loading state.
    await findByRole("group", { name: /quiet hours/i });
    expect(await findByRole("group", { name: /known-visitor tagging/i })).toBeInTheDocument();
    expect(await findByRole("group", { name: /haptic pattern overrides/i })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it("discloses the known-visitor-tagging opt-in inline next to its toggle", async () => {
    const { findByRole, getByText } = render(<SettingsPanel onClose={() => {}} />);
    await findByRole("group", { name: /known-visitor tagging/i });
    expect(getByText(/opt-in only/i)).toBeInTheDocument();
  });

  it("lets a keyboard user reach and activate Close without a mouse", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { findByRole, getByRole } = render(<SettingsPanel onClose={onClose} />);
    await findByRole("group", { name: /quiet hours/i });

    await user.tab();
    await waitFor(() => expect(getByRole("button", { name: /close/i })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
