import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeviceTimeZone } = vi.hoisted(() => ({ mockDeviceTimeZone: vi.fn(() => "UTC") }));
vi.mock("../../src/lib/timeZones", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/timeZones")>()),
  deviceTimeZone: () => mockDeviceTimeZone(),
}));

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
    mockDeviceTimeZone.mockReturnValue("UTC");
  });

  it("groups each preference section under a fieldset/legend and passes axe", async () => {
    const { container, findByRole } = render(<SettingsPanel onClose={() => {}} />);

    // Wait for the initial preferences fetch to resolve past the loading state.
    await findByRole("group", { name: /quiet hours/i });
    expect(await findByRole("group", { name: /known-visitor tagging/i })).toBeInTheDocument();
    expect(await findByRole("group", { name: /haptic pattern overrides/i })).toBeInTheDocument();
    expect(await findByRole("group", { name: /time zone/i })).toBeInTheDocument();

    await expectNoA11yViolations(container);
  });

  it("discloses the known-visitor-tagging opt-in inline next to its toggle", async () => {
    const { findByRole, getByText } = render(<SettingsPanel onClose={() => {}} />);
    await findByRole("group", { name: /known-visitor tagging/i });
    expect(getByText(/opt-in only/i)).toBeInTheDocument();
  });

  it("has a 'Play alert sounds' switch for this device, on by default, saved as soon as it's changed", async () => {
    const user = userEvent.setup();
    const { findByRole } = render(<SettingsPanel onClose={() => {}} />);
    const group = await findByRole("group", { name: /sound on this device/i });
    const toggle = await findByRole("checkbox", { name: "Play alert sounds" });
    expect(group).toContainElement(toggle);
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem("prism.alertSounds")).toBe("off");
    // A device setting, not the household's: nothing is saved to the backend.
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
    expect(writes).toEqual([]);
    window.localStorage.clear();
  });

  it("says next to the quiet hours toggle that a person at the door still alerts at full urgency", async () => {
    const { findByRole } = render(<SettingsPanel onClose={() => {}} />);
    const quietHours = await findByRole("group", { name: /quiet hours/i });
    expect(quietHours).toHaveTextContent("A person at the door always alerts at full urgency.");
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

  it("saves the chosen time zone along with local quiet hours", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const { findByLabelText, getByRole } = render(<SettingsPanel onClose={() => {}} />);

    await user.selectOptions(await findByLabelText("Household time zone"), "Asia/Kolkata");
    await user.click(getByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/preferences$/), expect.objectContaining({ method: "PUT" })));
    const [, init] = fetchMock.mock.calls.find(([, options]) => options?.method === "PUT")!;
    expect(JSON.parse(String(init!.body))).toMatchObject({
      timeZone: "Asia/Kolkata",
      quietHours: { enabled: false, startHour: 22, endHour: 6 },
    });
  });

  it("offers this device's time zone when it differs from the saved one", async () => {
    mockDeviceTimeZone.mockReturnValue("America/Chicago");
    const user = userEvent.setup();
    const { findByRole, getByLabelText, queryByRole } = render(<SettingsPanel onClose={() => {}} />);

    await user.click(await findByRole("button", { name: "Use this device's time zone (Central — CST/CDT)" }));

    expect(getByLabelText("Household time zone")).toHaveValue("America/Chicago");
    expect(queryByRole("button", { name: /use this device's time zone/i })).not.toBeInTheDocument();
  });

  it("keeps a saved time zone that isn't in the common list selectable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...DEFAULT_PREFERENCES, timeZone: "America/Halifax" }) } as Response),
    );
    const { findByLabelText } = render(<SettingsPanel onClose={() => {}} />);
    await waitFor(async () => expect(await findByLabelText("Household time zone")).toHaveValue("America/Halifax"));
  });
});
