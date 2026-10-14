import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeEvents } from "../../src/hooks/useRealtimeEvents";
import type { CompanionEventMessage } from "../../src/types";

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
}

function message(id: string, occurredAt: string): CompanionEventMessage {
  return { type: "prism-event", event: { id, occurredAt, snapshotUrl: `file:///${id}.jpg` }, channels: {} };
}

describe("useRealtimeEvents", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads recent stored alerts, without treating them as live", async () => {
    const stored = [message("b", "2026-10-14T10:00:00Z"), message("a", "2026-10-14T09:00:00Z")];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: stored }) }));

    const { result } = renderHook(() => useRealtimeEvents());

    await waitFor(() => expect(result.current.events.map((m) => m.event.id)).toEqual(["b", "a"]));
    expect(result.current.latestEvent?.event.id).toBe("b");
    expect(result.current.latestLiveEvent).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/alerts\?limit=20$/);
  });

  it("puts live events first, once each, and clears everything on request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ alerts: [message("a", "2026-10-14T09:00:00Z")] }) }),
    );
    const { result } = renderHook(() => useRealtimeEvents());
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    const live = message("c", "2026-10-14T11:00:00Z");
    act(() => {
      FakeSocket.instances[0].onmessage?.({ data: JSON.stringify(live) });
      FakeSocket.instances[0].onmessage?.({ data: JSON.stringify(live) });
    });

    expect(result.current.events.map((m) => m.event.id)).toEqual(["c", "a"]);
    expect(result.current.latestLiveEvent?.event.id).toBe("c");

    act(() => result.current.clear());
    expect(result.current.events).toEqual([]);
    expect(result.current.latestLiveEvent).toBeNull();
  });

  it("still shows live alerts when the stored ones can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useRealtimeEvents());

    act(() => FakeSocket.instances[0].onmessage?.({ data: JSON.stringify(message("c", "2026-10-14T11:00:00Z")) }));
    await waitFor(() => expect(result.current.latestEvent?.event.id).toBe("c"));
  });
});
