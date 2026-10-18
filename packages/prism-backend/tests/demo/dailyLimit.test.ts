import { afterEach, describe, expect, it } from "vitest";
import { DailyLimit, dailyLimitFromEnv } from "../../src/demo/dailyLimit";

afterEach(() => {
  delete process.env.SOME_DAILY_LIMIT;
});

describe("DailyLimit", () => {
  it("allows up to the cap each UTC day, then starts over the next day", () => {
    let now = new Date("2026-10-20T23:59:00Z");
    const limit = new DailyLimit(2, () => now);
    expect([limit.take(), limit.take(), limit.take()]).toEqual([true, true, false]);
    now = new Date("2026-10-21T00:00:01Z");
    expect(limit.take()).toBe(true);
  });

  it("never refuses without a cap", () => {
    const limit = new DailyLimit(null);
    for (let i = 0; i < 1000; i += 1) expect(limit.take()).toBe(true);
  });
});

describe("dailyLimitFromEnv", () => {
  it("reads a whole number, treats unset as no cap, and rejects anything else", () => {
    expect(dailyLimitFromEnv("SOME_DAILY_LIMIT")).toBeNull();
    process.env.SOME_DAILY_LIMIT = "300";
    expect(dailyLimitFromEnv("SOME_DAILY_LIMIT")).toBe(300);
    for (const value of ["0", "-1", "1.5", "lots"]) {
      process.env.SOME_DAILY_LIMIT = value;
      expect(() => dailyLimitFromEnv("SOME_DAILY_LIMIT")).toThrow(/SOME_DAILY_LIMIT/);
    }
  });
});
