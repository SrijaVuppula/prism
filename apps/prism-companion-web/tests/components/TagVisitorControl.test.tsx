import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagVisitorControl } from "../../src/components/TagVisitorControl";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("TagVisitorControl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a real labeled form, not a prompt(), and passes axe once opened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    const user = userEvent.setup();
    const { container, getByRole } = render(<TagVisitorControl visitorGroupId="grp_1" />);

    await expectNoA11yViolations(container);

    await user.click(getByRole("button", { name: /recognize this visitor/i }));
    const input = getByRole("textbox", { name: /who is this/i });
    expect(input).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("saves a label and announces the result via role=status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true } as Response));
    const user = userEvent.setup();
    const { getByRole } = render(<TagVisitorControl visitorGroupId="grp_2" />);

    await user.click(getByRole("button", { name: /recognize this visitor/i }));
    await user.type(getByRole("textbox", { name: /who is this/i }), "Mail carrier");
    await user.click(getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(getByRole("status")).toHaveTextContent(/tagged as "mail carrier"/i));
  });

  it("surfaces a save failure via role=alert rather than failing silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const user = userEvent.setup();
    const { container, getByRole } = render(<TagVisitorControl visitorGroupId="grp_3" />);

    await user.click(getByRole("button", { name: /recognize this visitor/i }));
    await user.type(getByRole("textbox", { name: /who is this/i }), "Neighbor");
    await user.click(getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(getByRole("alert")).toHaveTextContent(/couldn't save/i));
    await expectNoA11yViolations(container);
  });
});
