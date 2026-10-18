import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoNote, isDemoNoteEnabled } from "../../src/components/DemoNote";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("DemoNote", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says what to press, as a labelled note, and passes axe", async () => {
    const { container, getByRole } = render(<DemoNote />);
    const note = getByRole("note", { name: "About this demo" });
    expect(note).toHaveTextContent("Press Send a test visitor");
    expect(note).toHaveTextContent("What did I miss?");
    await expectNoA11yViolations(container);
  });

  it("is on only in a build made with VITE_DEMO_NOTE=1", () => {
    expect(isDemoNoteEnabled()).toBe(false);
    vi.stubEnv("VITE_DEMO_NOTE", "1");
    expect(isDemoNoteEnabled()).toBe(true);
  });
});
