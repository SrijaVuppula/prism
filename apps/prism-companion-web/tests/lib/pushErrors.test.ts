import { describe, expect, it } from "vitest";
import { describePushError, NO_PUSH_SERVICE_MESSAGE } from "../../src/lib/pushErrors";

describe("describePushError", () => {
  it("explains the 'push service not available' failure from browsers without a push service", () => {
    const err = new DOMException("Registration failed - push service not available", "AbortError");
    expect(describePushError(err)).toBe(NO_PUSH_SERVICE_MESSAGE);
  });

  it("passes other errors through unchanged", () => {
    expect(describePushError(new Error("Failed to fetch the push public key (500)"))).toBe(
      "Failed to fetch the push public key (500)",
    );
  });

  it("falls back to a generic message for non-Error values", () => {
    expect(describePushError("nope")).toBe("Failed to enable push notifications.");
  });
});
