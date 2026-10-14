import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestVisitorButton } from "../../src/components/TestVisitorButton";
import { expectNoA11yViolations } from "../a11y/axeHelper";

function respond(body: unknown, status = 202) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe("TestVisitorButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a test visitor and says what's coming, and passes axe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond({ status: "sent", label: "doorbell press by a visitor" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container, getByRole } = render(<TestVisitorButton />);

    await user.click(getByRole("button", { name: "Send a test visitor" }));

    expect(getByRole("status")).toHaveTextContent(
      "Sent a test doorbell press by a visitor. The alert appears in a few seconds.",
    );
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/test-visitor$/), { method: "POST" });
    await expectNoA11yViolations(container);
  });

  it("shows the server's reason when it can't send one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond({ error: "Test visitors are turned off on this server." }, 404)));
    const user = userEvent.setup();
    const { getByRole } = render(<TestVisitorButton />);

    await user.click(getByRole("button", { name: "Send a test visitor" }));

    expect(getByRole("status")).toHaveTextContent("Test visitors are turned off on this server.");
    expect(getByRole("button", { name: "Send a test visitor" })).toBeEnabled();
  });
});
