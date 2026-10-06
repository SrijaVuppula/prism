import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, PreferencesStore } from "../../src/preferences/preferencesStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

describe("PreferencesStore", () => {
  it("returns DEFAULT_PREFERENCES when no row exists for the household", async () => {
    const pool = fakePool([]);
    const store = new PreferencesStore(pool);
    expect(await store.get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("maps a stored row back to UserPreferences", async () => {
    const pool = fakePool([
      {
        time_zone: "America/Denver",
        haptic_overrides: { Urgent: [1, 2, 3] },
        quiet_hours_enabled: true,
        quiet_hours_start_hour: 22,
        quiet_hours_end_hour: 6,
        known_visitor_tagging_enabled: true,
      },
    ]);
    const store = new PreferencesStore(pool);

    expect(await store.get("default")).toEqual({
      timeZone: "America/Denver",
      hapticOverrides: { Urgent: [1, 2, 3] },
      quietHours: { enabled: true, startHour: 22, endHour: 6 },
      knownVisitorTaggingEnabled: true,
    });
  });

  it("upserts preferences for the household", async () => {
    const pool = fakePool();
    const store = new PreferencesStore(pool);
    const preferences = {
      timeZone: "Asia/Kolkata",
      hapticOverrides: { Notable: [50, 50] },
      quietHours: { enabled: true, startHour: 21, endHour: 7 },
      knownVisitorTaggingEnabled: true,
    };

    await store.save(preferences);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(household_id\) DO UPDATE/);
    expect(params).toEqual([
      "default",
      "Asia/Kolkata",
      JSON.stringify(preferences.hapticOverrides),
      true,
      21,
      7,
      true,
    ]);
  });
});
