// @vitest-environment node
// (vite.config.ts pulls in esbuild, which refuses to load under jsdom.)
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

describe("vite dev server proxy", () => {
  it("forwards every backend path the app calls", () => {
    const proxy = viteConfig.server?.proxy ?? {};
    // The WebSocket stream, push opt-in, preferences, visitor tagging,
    // alert feedback, event snapshots and the data controls all use
    // same-origin URLs in dev.
    for (const prefix of ["/ws", "/push", "/preferences", "/visitors", "/alerts", "/events", "/data"]) {
      expect(proxy).toHaveProperty([prefix]);
    }
  });
});
