import { describe, expect, it } from "vitest";
import { hourInTimeZone, isValidTimeZone } from "../../src/preferences/timeZone";

describe("isValidTimeZone", () => {
  it("accepts IANA time zone names and rejects anything else", () => {
    for (const zone of ["UTC", "America/New_York", "America/Phoenix", "Asia/Kolkata", "Europe/London"]) {
      expect(isValidTimeZone(zone)).toBe(true);
    }
    for (const value of ["Not/AZone", "", 5, null, undefined]) {
      expect(isValidTimeZone(value)).toBe(false);
    }
  });
});

describe("hourInTimeZone", () => {
  const instant = new Date("2026-01-15T04:30:00.000Z");

  it("returns the local hour in the given zone", () => {
    expect(hourInTimeZone(instant, "UTC")).toBe(4);
    expect(hourInTimeZone(instant, "America/New_York")).toBe(23); // EST, UTC-5
    expect(hourInTimeZone(instant, "America/Los_Angeles")).toBe(20); // PST, UTC-8
    expect(hourInTimeZone(instant, "Asia/Kolkata")).toBe(10); // IST, UTC+5:30
  });

  it("follows daylight saving time", () => {
    expect(hourInTimeZone(new Date("2026-07-15T04:30:00.000Z"), "America/New_York")).toBe(0); // EDT, UTC-4
  });

  it("reports midnight as 0, not 24", () => {
    expect(hourInTimeZone(new Date("2026-01-15T00:15:00.000Z"), "UTC")).toBe(0);
  });

  it("falls back to UTC for an unrecognized zone", () => {
    expect(hourInTimeZone(instant, "Not/AZone")).toBe(4);
  });
});
