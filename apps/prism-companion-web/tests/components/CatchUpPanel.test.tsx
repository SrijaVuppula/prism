import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatchUpPanel } from "../../src/components/CatchUpPanel";
import { expectNoA11yViolations } from "../a11y/axeHelper";

function respond(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe("CatchUpPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      respond({ answer: "One Urgent alert: a person at the Front Door at 2:40 AM.\nAlso two Routine alerts." }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says what it covers, and passes axe", async () => {
    const { container, getByText, rerender } = render(
      <CatchUpPanel since="2026-10-14T03:00:00.000Z" timeZone="America/Los_Angeles" />,
    );
    expect(getByText("Covers everything since you last had Prism open (Tue 8:00 PM).")).toBeInTheDocument();
    await expectNoA11yViolations(container);

    rerender(<CatchUpPanel />);
    expect(getByText("Covers the last 24 hours.")).toBeInTheDocument();
  });

  it("asks what was missed since the last visit and shows the answer, one paragraph per line", async () => {
    const user = userEvent.setup();
    const { getByRole, findByText, container } = render(<CatchUpPanel since="2026-10-14T03:00:00.000Z" />);

    await user.click(getByRole("button", { name: "What did I miss?" }));

    expect(await findByText("One Urgent alert: a person at the Front Door at 2:40 AM.")).toBeInTheDocument();
    expect(await findByText("Also two Routine alerts.")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/catch-up$/);
    expect(JSON.parse(String(init.body))).toEqual({ since: "2026-10-14T03:00:00.000Z" });
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("One Urgent alert");
  });

  it("sends the household's own question", async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByRole, findByText } = render(<CatchUpPanel />);

    expect(getByRole("button", { name: "Ask" })).toBeDisabled();
    await user.type(getByLabelText("Or ask about your alerts"), "Did a package come today?");
    await user.click(getByRole("button", { name: "Ask" }));

    await findByText(/One Urgent alert/);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ question: "Did a package come today?" });
  });

  it("shows the backend's message when the summary isn't available", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(respond({ error: "The catch-up summary isn't available right now." }, 502));
    const user = userEvent.setup();
    const { getByRole, findByText } = render(<CatchUpPanel />);

    await user.click(getByRole("button", { name: "What did I miss?" }));

    expect(await findByText("The catch-up summary isn't available right now.")).toBeInTheDocument();
    await waitFor(() => expect(getByRole("button", { name: "What did I miss?" })).toBeEnabled());
  });
});
