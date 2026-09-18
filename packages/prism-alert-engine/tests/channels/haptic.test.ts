import { describe, expect, it } from "vitest";
import { encodeHapticPattern } from "../../src/channels/haptic";
import type { SignalClass } from "../../src/types";

describe("encodeHapticPattern", () => {
  const classes: SignalClass[] = ["Routine", "Notable", "Urgent"];

  it.each(classes)("returns a non-empty vibration pattern for %s", (signalClass) => {
    const pattern = encodeHapticPattern(signalClass);
    expect(pattern.length).toBeGreaterThan(0);
    expect(pattern.every((ms) => ms > 0)).toBe(true);
  });

  it("returns a distinct pattern per Signal Class", () => {
    const patterns = classes.map(encodeHapticPattern);
    const serialized = patterns.map((p) => p.join(","));
    expect(new Set(serialized).size).toBe(classes.length);
  });

  it("escalates pattern length/duration with severity", () => {
    const routine = encodeHapticPattern("Routine");
    const notable = encodeHapticPattern("Notable");
    const urgent = encodeHapticPattern("Urgent");

    const sum = (p: number[]) => p.reduce((a, b) => a + b, 0);

    expect(routine.length).toBeLessThan(urgent.length);
    expect(sum(notable)).toBeLessThan(sum(urgent));
  });
});
