// Pure quiet-hours-window check, kept separate from preferencesStore.ts so
// it's trivially unit-testable without a Pool. Hours are local to the
// household's time zone (see timeZone.ts), the same zone
// agentOrchestration.ts uses for the Signal Score's time-of-day factor.

import { DEFAULT_TIME_ZONE, hourInTimeZone } from "./timeZone";

export interface QuietHours {
  enabled: boolean;
  /** Local hour (0-23) quiet hours begin. */
  startHour: number;
  /** Local hour (0-23) quiet hours end (exclusive). */
  endHour: number;
}

/**
 * True when `date`'s local hour in `timeZone` falls within
 * [startHour, endHour). Supports an overnight window where endHour <
 * startHour (e.g. 22 -> 6 means "22:00 through 05:59").
 */
export function isWithinQuietHours(date: Date, quietHours: QuietHours, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  if (!quietHours.enabled) return false;
  const hour = hourInTimeZone(date, timeZone);
  const { startHour, endHour } = quietHours;

  if (startHour === endHour) {
    // A zero-width window is treated as "always on" rather than "never on"
    // -- e.g. a user who sets start === end almost certainly means "all day"
    // rather than an instant that never matches any whole hour.
    return true;
  }
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Overnight window: wraps past midnight.
  return hour >= startHour || hour < endHour;
}
