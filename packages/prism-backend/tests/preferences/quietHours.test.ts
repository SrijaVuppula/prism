import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "../../src/preferences/quietHours";

describe("isWithinQuietHours", () => {
  it("returns false when quiet hours are disabled", () => {
    expect(
      isWithinQuietHours(new Date("2026-01-01T23:00:00.000Z"), {
        enabled: false,
        startHour: 22,
        endHour: 6,
      }),
    ).toBe(false);
  });

  it("matches inside an overnight window", () => {
    const quietHours = { enabled: true, startHour: 22, endHour: 6 };
    expect(isWithinQuietHours(new Date("2026-01-01T23:00:00.000Z"), quietHours)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T02:00:00.000Z"), quietHours)).toBe(true);
  });

  it("does not match outside an overnight window", () => {
    const quietHours = { enabled: true, startHour: 22, endHour: 6 };
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00.000Z"), quietHours)).toBe(false);
    expect(isWithinQuietHours(new Date("2026-01-01T06:00:00.000Z"), quietHours)).toBe(false);
  });

  it("matches inside a same-day window", () => {
    const quietHours = { enabled: true, startHour: 9, endHour: 17 };
    expect(isWithinQuietHours(new Date("2026-01-01T12:00:00.000Z"), quietHours)).toBe(true);
    expect(isWithinQuietHours(new Date("2026-01-01T20:00:00.000Z"), quietHours)).toBe(false);
  });

  it("evaluates the window in the household's time zone", () => {
    const quietHours = { enabled: true, startHour: 22, endHour: 6 };
    // 03:30 UTC is 23:30 the previous evening in New York (EDT, UTC-4) and
    // 09:00 in Kolkata (IST, UTC+5:30).
    const instant = new Date("2026-07-01T03:30:00.000Z");
    expect(isWithinQuietHours(instant, quietHours, "America/New_York")).toBe(true);
    expect(isWithinQuietHours(instant, quietHours, "Asia/Kolkata")).toBe(false);
  });

  it("treats a zero-width window as always on", () => {
    const quietHours = { enabled: true, startHour: 9, endHour: 9 };
    expect(isWithinQuietHours(new Date("2026-01-01T03:00:00.000Z"), quietHours)).toBe(true);
  });
});
