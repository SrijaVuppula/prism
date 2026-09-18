import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "../../src/preferences/quietHours";

describe("isWithinQuietHours", () => {
  it("returns false when quiet hours are disabled", () => {
    expect(
      isWithinQuietHours(new Date("2026-01-01T23:00:00.000Z"), {
        enabled: false,
        startHourUtc: 22,
        endHourUtc: 6,
      }),
    ).toBe(false);
  });

  it("matches inside an overnight window", () => {
    const quietHours = { enabled: true, startHourUtc: 22, endHourUtc: 6 };
    expect(isWithinQuietHours(new Date("2026-01-01T23:00:00.000Z"), quietHours)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T02:00:00.000Z"), quietHours)).toBe(true);
  });

  it("does not match outside an overnight window", () => {
    const quietHours = { enabled: true, startHourUtc: 22, endHourUtc: 6 };
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00.000Z"), quietHours)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-01-01T06:00:00.000Z"), quietHours)).toBe(false);
  });

  it("matches inside a same-day window", () => {
    const quietHours = { enabled: true, startHourUtc: 9, endHourUtc: 17 };
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00.000Z"), quietHours)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T20:00:00.000Z"), quietHours)).toBe(false);
  });

  it("treats a zero-width window as always on", () => {
    const quietHours = { enabled: true, startHourUtc: 9, endHourUtc: 9 };
    expect(isWithinQuietHours(new Date("2026-01-01T03:00:00.000Z"), quietHours)).toBe(true);
  });
});
