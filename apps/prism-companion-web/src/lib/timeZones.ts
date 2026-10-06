// Time zones offered in Settings. Each is an IANA name, so daylight saving
// time is handled automatically (e.g. Eastern Time is EST in winter and EDT
// in summer). The household's saved zone, or this device's own zone, is
// added to the list when it isn't one of these.

export interface TimeZoneOption {
  value: string;
  label: string;
}

export const COMMON_TIME_ZONES: TimeZoneOption[] = [
  { value: "America/New_York", label: "Eastern — EST/EDT" },
  { value: "America/Chicago", label: "Central — CST/CDT" },
  { value: "America/Denver", label: "Mountain — MST/MDT" },
  { value: "America/Phoenix", label: "Arizona — MST" },
  { value: "America/Los_Angeles", label: "Pacific — PST/PDT" },
  { value: "America/Anchorage", label: "Alaska — AKST/AKDT" },
  { value: "Pacific/Honolulu", label: "Hawaii — HST" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "UK — GMT/BST" },
  { value: "Europe/Berlin", label: "Central Europe — CET/CEST" },
  { value: "Asia/Dubai", label: "Gulf — GST (Dubai)" },
  { value: "Asia/Kolkata", label: "India — IST" },
  { value: "Asia/Singapore", label: "Singapore — SGT" },
  { value: "Asia/Tokyo", label: "Japan — JST" },
  { value: "Australia/Sydney", label: "Sydney — AEST/AEDT" },
];

/** This device's IANA time zone, or null if the browser doesn't report one. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function timeZoneLabel(value: string): string {
  return COMMON_TIME_ZONES.find((zone) => zone.value === value)?.label ?? value.replace(/_/g, " ");
}

/** The common zones plus any of `extra` not already listed. */
export function timeZoneOptions(...extra: Array<string | null | undefined>): TimeZoneOption[] {
  const options = [...COMMON_TIME_ZONES];
  for (const value of extra) {
    if (value && !options.some((zone) => zone.value === value)) {
      options.push({ value, label: timeZoneLabel(value) });
    }
  }
  return options;
}
