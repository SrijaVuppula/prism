// Postgres-backed storage for per-household alert preferences: the
// household's time zone, haptic pattern overrides, quiet hours, and the
// known-visitor-tagging opt-in.
//
// There is no per-user auth anywhere in this codebase yet (see
// push/subscriptionStore.ts and ring/routes.ts for the same placeholder
// state). Rather than invent real multi-user auth as a prerequisite for
// preferences, this store follows the same single-household shape: one row,
// keyed by a constant household id. That keeps today's behavior simple (one
// set of preferences, matching the one set of push subscriptions everyone
// shares) while keeping the schema forward-compatible -- swapping
// DEFAULT_HOUSEHOLD_ID for a real authenticated user/household id later is
// a call-site change, not a schema migration, since household_id is
// already a real column and not folded into a singleton assumption at the
// SQL level.

import type { Pool } from "pg";
import { getPool } from "../db/pool";
import type { HapticOverrides } from "prism-alert-engine";
import type { QuietHours } from "./quietHours";
import { DEFAULT_TIME_ZONE } from "./timeZone";

export const DEFAULT_HOUSEHOLD_ID = "default";

export interface UserPreferences {
  /** IANA time zone name; quiet hours and the late-night scoring factor use it. */
  timeZone: string;
  hapticOverrides: HapticOverrides;
  quietHours: QuietHours;
  /**
   * Strictly opt-in (default false). See docs/ACCESSIBILITY.md's
   * known-visitor-tagging privacy note: disclosed clearly, local-only
   * storage, never uploaded or shared. When false, repeat-visitor memory
   * still counts repeat visits (see db/vectorStore.ts) but never marks an
   * event as a known visitor, even if the household has tagged that
   * visitor group in the past.
   */
  knownVisitorTaggingEnabled: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timeZone: DEFAULT_TIME_ZONE,
  hapticOverrides: {},
  quietHours: { enabled: false, startHour: 22, endHour: 6 },
  knownVisitorTaggingEnabled: false,
};

interface UserPreferencesRow {
  time_zone: string;
  haptic_overrides: HapticOverrides;
  quiet_hours_enabled: boolean;
  quiet_hours_start_hour: number;
  quiet_hours_end_hour: number;
  known_visitor_tagging_enabled: boolean;
}

function rowToPreferences(row: UserPreferencesRow): UserPreferences {
  return {
    timeZone: row.time_zone,
    hapticOverrides: row.haptic_overrides ?? {},
    quietHours: {
      enabled: row.quiet_hours_enabled,
      startHour: row.quiet_hours_start_hour,
      endHour: row.quiet_hours_end_hour,
    },
    knownVisitorTaggingEnabled: row.known_visitor_tagging_enabled,
  };
}

export class PreferencesStore {
  constructor(private readonly pool: Pool) {}

  async get(householdId: string = DEFAULT_HOUSEHOLD_ID): Promise<UserPreferences> {
    const result = await this.pool.query<UserPreferencesRow>(
      `SELECT time_zone, haptic_overrides, quiet_hours_enabled, quiet_hours_start_hour, quiet_hours_end_hour,
              known_visitor_tagging_enabled
       FROM user_preferences
       WHERE household_id = $1`,
      [householdId],
    );
    const row = result.rows[0];
    return row ? rowToPreferences(row) : DEFAULT_PREFERENCES;
  }

  async save(preferences: UserPreferences, householdId: string = DEFAULT_HOUSEHOLD_ID): Promise<UserPreferences> {
    await this.pool.query(
      `INSERT INTO user_preferences (
         household_id, time_zone, haptic_overrides, quiet_hours_enabled, quiet_hours_start_hour, quiet_hours_end_hour,
         known_visitor_tagging_enabled, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (household_id) DO UPDATE SET
         time_zone = EXCLUDED.time_zone,
         haptic_overrides = EXCLUDED.haptic_overrides,
         quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
         quiet_hours_start_hour = EXCLUDED.quiet_hours_start_hour,
         quiet_hours_end_hour = EXCLUDED.quiet_hours_end_hour,
         known_visitor_tagging_enabled = EXCLUDED.known_visitor_tagging_enabled,
         updated_at = now()`,
      [
        householdId,
        preferences.timeZone,
        JSON.stringify(preferences.hapticOverrides),
        preferences.quietHours.enabled,
        preferences.quietHours.startHour,
        preferences.quietHours.endHour,
        preferences.knownVisitorTaggingEnabled,
      ],
    );
    return preferences;
  }
}

export function getPreferencesStore(): PreferencesStore {
  return new PreferencesStore(getPool());
}
