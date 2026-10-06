// Household time zone helpers. Time zones are IANA names (e.g.
// "America/New_York", "Asia/Kolkata") rather than fixed offsets like
// "EST", so daylight saving time is handled by the runtime's time zone
// data instead of by this code.

export const DEFAULT_TIME_ZONE = "UTC";

/** True for any time zone name the runtime recognizes. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Local hour (0-23) of `date` in `timeZone`. Falls back to UTC for a zone
 * the runtime doesn't recognize, so a bad stored value degrades scoring
 * instead of breaking alert delivery.
 */
export function hourInTimeZone(date: Date, timeZone: string): number {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  return Number(hour) % 24;
}
