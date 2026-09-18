// jsdom has no serviceWorker/PushManager, so isPushSupported() in
// usePushSubscription.ts is false in every test here -- this exercises the
// real "unsupported" fallback path (Safari/iOS today), which is exactly
// the branch that needs to degrade gracefully without blocking the rest of
// the app.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnablePushButton } from "../../src/components/EnablePushButton";
import { expectNoA11yViolations } from "../a11y/axeHelper";

describe("EnablePushButton", () => {
  it("tells the user push isn't supported here (status role, not a dead button) and passes axe", async () => {
    const { container, getByRole } = render(<EnablePushButton />);
    expect(getByRole("status")).toHaveTextContent(/aren't supported/i);
    await expectNoA11yViolations(container);
  });
});
