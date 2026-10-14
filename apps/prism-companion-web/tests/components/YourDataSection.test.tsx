import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YourDataSection } from "../../src/components/YourDataSection";
import { expectNoA11yViolations } from "../a11y/axeHelper";

function respond(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe("YourDataSection", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? respond({ storedAlerts: 0 }) : respond({ retentionDays: 30, storedAlerts: 12 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says what's stored, for how long, and that snapshots aren't kept, and passes axe", async () => {
    const { container, findByText, getByRole, getByText } = render(<YourDataSection />);

    expect(getByRole("region", { name: "Your data" })).toBeInTheDocument();
    expect(await findByText("Stored now: 12 alerts.")).toBeInTheDocument();
    expect(getByText(/for 30 days, then deletes them automatically/)).toBeInTheDocument();
    expect(getByText(/Snapshots aren't saved/)).toBeInTheDocument();
    expect(getByText(/privacy zones blacked out/)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("asks before deleting, then deletes, confirms and clears the alerts on screen", async () => {
    const user = userEvent.setup();
    const onHistoryDeleted = vi.fn();
    const { findByText, getByRole } = render(<YourDataSection onHistoryDeleted={onHistoryDeleted} />);
    await findByText("Stored now: 12 alerts.");

    await user.click(getByRole("button", { name: "Delete alert history" }));
    const question = getByRole("group", { name: /Delete all 12 alerts, with visitor memory, votes and visitor tags\?/ });
    expect(question).toBeInTheDocument();
    expect(getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: "DELETE" }));

    await user.click(getByRole("button", { name: "Delete permanently" }));

    expect(await findByText("Alert history deleted.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/data\/history$/), { method: "DELETE" });
    expect(onHistoryDeleted).toHaveBeenCalledTimes(1);
    expect(await findByText("Stored now: 0 alerts.")).toBeInTheDocument();
    expect(getByRole("button", { name: "Delete alert history" })).toHaveFocus();
  });

  it("deletes nothing when the household cancels", async () => {
    const user = userEvent.setup();
    const { findByText, getByRole } = render(<YourDataSection />);
    await findByText("Stored now: 12 alerts.");

    await user.click(getByRole("button", { name: "Delete alert history" }));
    await user.click(getByRole("button", { name: "Cancel" }));

    expect(getByRole("button", { name: "Delete alert history" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says so when the delete fails, and keeps the alerts on screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? respond({}, false) : respond({ retentionDays: 30, storedAlerts: 1 }),
    );
    const user = userEvent.setup();
    const onHistoryDeleted = vi.fn();
    const { findByText, getByRole } = render(<YourDataSection onHistoryDeleted={onHistoryDeleted} />);
    await findByText("Stored now: 1 alert.");

    await user.click(getByRole("button", { name: "Delete alert history" }));
    await user.click(getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(getByRole("status")).toHaveTextContent("Couldn't delete the alert history."));
    expect(onHistoryDeleted).not.toHaveBeenCalled();
    expect(await findByText("Stored now: 1 alert.")).toBeInTheDocument();
  });
});
