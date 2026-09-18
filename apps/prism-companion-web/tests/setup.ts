// Shared vitest setup for the companion app's DOM tests: brings in
// jest-dom's matchers (toBeInTheDocument, toHaveAttribute, etc.) and
// unmounts each test's render between tests, since vitest's default
// (non-globals) config means Testing Library can't auto-detect the test
// framework to register this itself.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});
