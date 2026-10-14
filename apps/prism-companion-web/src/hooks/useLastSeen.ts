// When the household last had the app open, for "What did I miss?": the
// time the page was last hidden or closed, kept in localStorage. Storage
// can be unavailable (private windows, blocked site data), in which case
// there's simply no last-seen time and the catch-up covers the last day.

import { useEffect, useState } from "react";

export const LAST_SEEN_KEY = "prism.lastSeenAt";

function read(): string | undefined {
  try {
    const value = window.localStorage.getItem(LAST_SEEN_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
  } catch {
    return undefined;
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, value);
  } catch {
    // Nothing to do: the next catch-up covers the last day instead.
  }
}

const systemNow = () => new Date();

export function useLastSeen(now: () => Date = systemNow): string | undefined {
  const [lastSeen, setLastSeen] = useState<string | undefined>(read);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") write(now().toISOString());
      else setLastSeen(read());
    };
    const onPageHide = () => write(now().toISOString());
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [now]);

  return lastSeen;
}
