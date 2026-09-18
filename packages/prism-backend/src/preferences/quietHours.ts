// Pure quiet-hours-window check, kept separate from preferencesStore.ts so
// it's trivially unit-testable without a Pool. Hours are UTC, matching
// agentOrchestration.ts's existing hourOfDay() (also UTC -- see its
// docblock on why: no per-device timezone is available yet).

export interface QuietHours {
  enabled: boolean;
  /** Hour (0-23, UTC) quiet hours begin. */
  startHourUtc: number;
  /** Hour (0-23, UTC) quiet hours end (exclusive). */
  endHourUtc: number;
}

/**
 * True when `date`'s UTC hour falls within [startHourUtc, endHourUtc).
 * Supports an overnight window where endHourUtc < startHourUtc (e.g.
 * 22 -> 6 means "22:00 through 05:59").
 */
export function isWithinQuietHours(date: Date, quietHours: QuietHours): boolean {
  if (!quietHours.enabled) return false;

  const hour = date.getUTCHours();
  const { startHourUtc, endHourUtc } = quietHours;

  if (startHourUtc === endHourUtc) {
    // A zero-width window is treated as "always on" rather than "never on"
    // -- e.g. a user who sets start === end almost certainly means "all day"
    // rather than an instant that never matches any whole hour.
    return true;
  }

  if (startHourUtc < endHourUtc) {
    return hour >= startHourUtc && hour < endHourUtc;
  }

  // Overnight window: wraps past midnight.
  return hour >= startHourUtc || hour < endHourUtc;
}
