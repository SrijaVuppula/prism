import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historyEventToAlert, RingHistoryCatchUp, startRingHistoryCatchUp } from "../../src/ring/eventHistory";
import type { RingHistoryEvent } from "../../src/ring/ringClient";
import { parseRingSnapshotUrl } from "../../src/ring/snapshots";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const MIN = 60_000;

function historyEvent(id: string, eventType: string, minutesAgo: number, deviceId = "dev-a"): RingHistoryEvent {
  return { id, eventType, deviceId, start: NOW - minutesAgo * MIN };
}

describe("historyEventToAlert", () => {
  it("turns a doorbell press into a ding with Ring's snapshot of that moment", () => {
    const alert = historyEventToAlert(historyEvent("h1", "ding", 30));
    expect(alert).toMatchObject({
      kind: "ding",
      event: { id: "h1", occurredAt: new Date(NOW - 30 * MIN).toISOString(), deviceId: "dev-a" },
      fallbackClassification: { category: "person" },
    });
    expect(parseRingSnapshotUrl(alert!.event.snapshotUrl)).toEqual({ deviceId: "dev-a", timestamp: NOW - 30 * MIN });
  });

  it("maps motion sub-types, including the animal one only the history has", () => {
    expect(historyEventToAlert(historyEvent("h", "motion.human", 1))).toMatchObject({
      kind: "person-detected",
      fallbackClassification: { category: "person" },
    });
    expect(historyEventToAlert(historyEvent("h", "motion.vehicle", 1))).toMatchObject({
      kind: "motion",
      fallbackClassification: { category: "vehicle" },
    });
    expect(historyEventToAlert(historyEvent("h", "motion.animal", 1))).toMatchObject({
      kind: "motion",
      fallbackClassification: { category: "animal" },
    });
    for (const type of ["motion", "motion.other_motion"]) {
      const alert = historyEventToAlert(historyEvent("h", type, 1));
      expect(alert?.kind).toBe("motion");
      expect(alert?.fallbackClassification).toBeUndefined();
    }
  });

  it("ignores live view sessions", () => {
    expect(historyEventToAlert(historyEvent("h", "on_demand", 1))).toBeNull();
  });
});

describe("RingHistoryCatchUp", () => {
  let clock: number;
  let listDevices: ReturnType<typeof vi.fn>;
  let listEventHistory: ReturnType<typeof vi.fn>;
  let store: { save: ReturnType<typeof vi.fn>; hasEventNear: ReturnType<typeof vi.fn> };
  let pipeline: ReturnType<typeof vi.fn>;
  let getToken: ReturnType<typeof vi.fn>;

  function catchUp() {
    return new RingHistoryCatchUp({
      getToken,
      createClient: () => ({ listDevices, listEventHistory }),
      eventStore: () => store,
      runPipeline: pipeline as never,
      now: () => clock,
    });
  }

  beforeEach(() => {
    clock = NOW;
    getToken = vi.fn().mockResolvedValue("token");
    listDevices = vi.fn().mockResolvedValue([{ id: "dev-a", name: "Front Door" }]);
    listEventHistory = vi.fn().mockResolvedValue({ events: [] });
    store = { save: vi.fn().mockResolvedValue(true), hasEventNear: vi.fn().mockResolvedValue(false) };
    pipeline = vi.fn().mockResolvedValue({});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing without Ring access", async () => {
    getToken.mockResolvedValue(null);
    expect(await catchUp().run()).toEqual({ missed: 0, alerted: 0, storedQuietly: 0 });
    expect(listDevices).not.toHaveBeenCalled();
  });

  it("alerts for a recently missed event, stores an older one quietly, oldest first, and leaves live views alone", async () => {
    listEventHistory.mockResolvedValue({
      events: [
        historyEvent("recent", "motion.human", 3),
        historyEvent("live-view", "on_demand", 20),
        historyEvent("old", "ding", 90),
      ],
    });

    expect(await catchUp().run()).toEqual({ missed: 2, alerted: 1, storedQuietly: 1 });

    expect(listEventHistory).toHaveBeenCalledWith("dev-a", ["ding", "motion"], undefined);
    expect(pipeline.mock.calls.map(([event, , options]) => [event.id, options.quiet])).toEqual([
      ["old", true],
      ["recent", false],
    ]);
    expect(pipeline.mock.calls[1][2].fallbackClassification).toMatchObject({ category: "person" });
    const [savedEvent, kind, raw] = store.save.mock.calls[0];
    expect([savedEvent.id, kind]).toEqual(["old", "ding"]);
    expect(raw).toMatchObject({ relationships: { source: { data: { id: "dev-a" } } } });
  });

  it("skips events a webhook already delivered, and events stored before", async () => {
    listEventHistory.mockResolvedValue({ events: [historyEvent("dup", "ding", 10), historyEvent("seen", "ding", 12)] });
    store.hasEventNear.mockImplementation(async (_device: string, occurredAt: string) =>
      occurredAt === new Date(NOW - 10 * MIN).toISOString(),
    );
    store.save.mockResolvedValue(false);

    expect(await catchUp().run()).toEqual({ missed: 0, alerted: 0, storedQuietly: 0 });
    expect(store.hasEventNear).toHaveBeenCalledWith("dev-a", new Date(NOW - 10 * MIN).toISOString(), 15_000);
    expect(pipeline).not.toHaveBeenCalled();
  });

  it("leaves the last minute to webhooks, and looks back a day on the first read", async () => {
    listEventHistory.mockResolvedValue({
      events: [historyEvent("too-new", "ding", 0.5), historyEvent("in-range", "ding", 23 * 60), historyEvent("too-old", "ding", 25 * 60)],
    });

    await catchUp().run();

    expect(pipeline.mock.calls.map(([event]) => event.id)).toEqual(["in-range"]);
  });

  it("follows older pages until it passes the window, then starts the next read where this one ended", async () => {
    listEventHistory
      .mockResolvedValueOnce({ events: [historyEvent("p1", "ding", 60)], next: "/v1/history/devices/dev-a/events?page[key]=x" })
      .mockResolvedValueOnce({ events: [historyEvent("p2", "ding", 26 * 60)], next: "/v1/history/devices/dev-a/events?page[key]=y" });
    const target = catchUp();

    await target.run();
    expect(listEventHistory).toHaveBeenCalledTimes(2);
    expect(listEventHistory.mock.calls[1][2]).toBe("/v1/history/devices/dev-a/events?page[key]=x");
    expect(pipeline.mock.calls.map(([event]) => event.id)).toEqual(["p1"]);

    // Ten minutes later, only events since the last read (less the webhook grace) count.
    clock = NOW + 10 * MIN;
    listEventHistory.mockReset().mockResolvedValue({
      events: [historyEvent("new", "ding", -5), historyEvent("before-last-read", "ding", 3)],
    });
    await target.run();
    expect(pipeline.mock.calls.map(([event]) => event.id)).toEqual(["p1", "new"]);
  });

  it("keeps going when one event fails, and shares one read between overlapping calls", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listEventHistory.mockResolvedValue({ events: [historyEvent("ok", "ding", 10), historyEvent("bad", "motion", 20)] });
    pipeline.mockImplementation(async (event: { id: string }) => {
      if (event.id === "bad") throw new Error("no snapshot and no fallback");
      return {};
    });
    const target = catchUp();

    const [first, second] = await Promise.all([target.run(), target.run()]);
    expect(first).toBe(second);
    expect(first).toEqual({ missed: 2, alerted: 0, storedQuietly: 1 });
    expect(listDevices).toHaveBeenCalledTimes(1);
  });
});

describe("startRingHistoryCatchUp", () => {
  afterEach(() => {
    delete process.env.RING_HISTORY_POLL_MINUTES;
    vi.useRealTimers();
  });

  it("reads shortly after startup and then on the schedule, and logs failures", async () => {
    vi.useFakeTimers();
    process.env.RING_HISTORY_POLL_MINUTES = "2";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new Error("401")).mockResolvedValue({});

    const stop = startRingHistoryCatchUp({ run } as never);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/event history/), "401");
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(run).toHaveBeenCalledTimes(2);
    stop?.();
    error.mockRestore();
  });

  it("is off when RING_HISTORY_POLL_MINUTES is 0, and rejects a bad value", () => {
    process.env.RING_HISTORY_POLL_MINUTES = "0";
    expect(startRingHistoryCatchUp({ run: vi.fn() } as never)).toBeNull();
    process.env.RING_HISTORY_POLL_MINUTES = "often";
    expect(() => startRingHistoryCatchUp({ run: vi.fn() } as never)).toThrow(/RING_HISTORY_POLL_MINUTES/);
  });
});
