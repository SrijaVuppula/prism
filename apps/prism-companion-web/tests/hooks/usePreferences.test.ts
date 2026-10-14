import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, usePreferences } from "../../src/hooks/usePreferences";

const SAVED = { ...DEFAULT_PREFERENCES, timeZone: "America/New_York" };

describe("usePreferences", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps loading, and retries, while the backend is still starting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValue({ ok: true, json: async () => SAVED });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreferences());
    await act(async () => {});
    expect(result.current.loading).toBe(true);

    await act(async () => vi.advanceTimersByTime(2000));
    expect(result.current.loading).toBe(true);
    await act(async () => vi.advanceTimersByTime(2000));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.loading).toBe(false);
    expect(result.current.preferences.timeZone).toBe("America/New_York");
    expect(result.current.error).toBeNull();
  });

  it("gives up after ten tries and reports the error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePreferences());
    for (let i = 0; i < 10; i += 1) {
      await act(async () => vi.advanceTimersByTime(2000));
    }

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("ECONNREFUSED");
    expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
  });
});
