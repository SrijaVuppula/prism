import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAST_SEEN_KEY, useLastSeen } from "../../src/hooks/useLastSeen";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useLastSeen", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("starts with the time the app was last hidden, if any", () => {
    expect(renderHook(() => useLastSeen()).result.current).toBeUndefined();

    window.localStorage.setItem(LAST_SEEN_KEY, "2026-10-14T03:00:00.000Z");
    expect(renderHook(() => useLastSeen()).result.current).toBe("2026-10-14T03:00:00.000Z");
  });

  it("records when the app is hidden, and uses it once the app is back", () => {
    let now = new Date("2026-10-14T03:00:00.000Z");
    const clock = () => now;
    const { result } = renderHook(() => useLastSeen(clock));

    act(() => setVisibility("hidden"));
    expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBe("2026-10-14T03:00:00.000Z");
    now = new Date("2026-10-14T09:00:00.000Z");
    act(() => setVisibility("visible"));
    expect(result.current).toBe("2026-10-14T03:00:00.000Z");
  });

  it("works without storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useLastSeen());
    act(() => setVisibility("hidden"));
    expect(result.current).toBeUndefined();
  });
});
