import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_SOUNDS_KEY,
  playTones,
  readAlertSoundsEnabled,
  tonesForPattern,
  writeAlertSoundsEnabled,
} from "../../src/lib/alertSound";
import { FakeAudioContext } from "./fakeAudioContext";

describe("alert sounds", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("turns each pulse of a vibration pattern into a tone, keeping its rhythm", () => {
    // Urgent's default pattern: three 300 ms pulses with 150 ms gaps.
    expect(tonesForPattern([300, 150, 300, 150, 300])).toEqual([
      { start: 0, duration: 0.3 },
      { start: 0.45, duration: 0.3 },
      { start: 0.9, duration: 0.3 },
    ]);
    expect(tonesForPattern([150, 100, 150])).toEqual([
      { start: 0, duration: 0.15 },
      { start: 0.25, duration: 0.15 },
    ]);
    expect(tonesForPattern([0, 200, 100])).toEqual([{ start: 0.2, duration: 0.1 }]);
  });

  it("schedules one tone per pulse at the given pitch, from the context's current time", () => {
    const context = new FakeAudioContext();
    playTones(context as unknown as AudioContext, tonesForPattern([300, 150, 300]), 392);

    expect(context.oscillators).toHaveLength(2);
    const ms = (seconds?: number) => Math.round((seconds ?? NaN) * 1000) / 1000;
    expect(context.oscillators.map((oscillator) => [ms(oscillator.startedAt), ms(oscillator.stoppedAt)])).toEqual([
      [10, 10.3],
      [10.45, 10.75],
    ]);
    expect(context.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(392, 10);
  });

  it("is on by default, and remembers being switched off on this device", () => {
    expect(readAlertSoundsEnabled()).toBe(true);
    writeAlertSoundsEnabled(false);
    expect(window.localStorage.getItem(ALERT_SOUNDS_KEY)).toBe("off");
    expect(readAlertSoundsEnabled()).toBe(false);
    writeAlertSoundsEnabled(true);
    expect(readAlertSoundsEnabled()).toBe(true);
  });

  it("stays on when storage can't be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readAlertSoundsEnabled()).toBe(true);
  });
});
