// Shared vitest setup for the companion app's DOM tests: brings in
// jest-dom's matchers (toBeInTheDocument, toHaveAttribute, etc.) and
// unmounts each test's render between tests, since vitest's default
// (non-globals) config means Testing Library can't auto-detect the test
// framework to register this itself.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Node 25 and later have their own localStorage and sessionStorage globals,
// which are undefined unless Node is given a storage file, and they hide
// jsdom's. Point both back at jsdom's storage, as in a browser.
const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
for (const name of ["localStorage", "sessionStorage"] as const) {
  if (jsdom && globalThis[name] === undefined) {
    Object.defineProperty(globalThis, name, { value: jsdom.window[name], configurable: true, writable: true });
  }
}

afterEach(() => {
  cleanup();
});
