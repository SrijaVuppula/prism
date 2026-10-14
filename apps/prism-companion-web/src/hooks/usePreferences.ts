// Fetches and saves the household's alert preferences
// (prism-backend/src/preferences/routes.ts): time zone, haptic pattern
// overrides, quiet hours, and the known-visitor-tagging opt-in. Used by
// SettingsPanel, and by ContextCard indirectly (via HomePage) to show alert
// times in the household's time zone and to decide whether to offer the
// opt-in "tag this visitor" control at all.

import { useCallback, useEffect, useState } from "react";
import { resolveApiBase } from "../lib/apiBase";
import type { UserPreferences } from "../types";

export const DEFAULT_PREFERENCES: UserPreferences = {
  timeZone: "UTC",
  hapticOverrides: {},
  quietHours: { enabled: false, startHour: 22, endHour: 6 },
  knownVisitorTaggingEnabled: false,
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

const LOAD_ATTEMPTS = 10;
const LOAD_RETRY_MS = 2000;

export interface UsePreferencesResult {
  preferences: UserPreferences;
  loading: boolean;
  saveStatus: SaveStatus;
  error: string | null;
  save: (next: UserPreferences) => Promise<void>;
}

export function usePreferences(): UsePreferencesResult {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // The backend may still be starting (e.g. right after `npm run dev`
    // restarts), so a failed load is retried a few times before giving up.
    // Until then `loading` stays true, which keeps alert times in this
    // device's time zone rather than the UTC default.
    const load = async (attempt: number) => {
      try {
        const response = await fetch(`${resolveApiBase()}/preferences`);
        if (!response.ok) throw new Error(`Failed to load preferences (${response.status})`);
        const data = (await response.json()) as UserPreferences;
        if (cancelled) return;
        setPreferences(data);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (attempt < LOAD_ATTEMPTS) {
          retryTimer = setTimeout(() => void load(attempt + 1), LOAD_RETRY_MS);
          return;
        }
        console.error("[preferences] failed to load:", err);
        setError(err instanceof Error ? err.message : "Failed to load preferences.");
        setLoading(false);
      }
    };
    void load(1);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  const save = useCallback(async (next: UserPreferences) => {
    setSaveStatus("saving");
    setError(null);
    try {
      const response = await fetch(`${resolveApiBase()}/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error(`Failed to save preferences (${response.status})`);
      const saved = (await response.json()) as UserPreferences;
      setPreferences(saved);
      setSaveStatus("saved");
    } catch (err) {
      console.error("[preferences] failed to save:", err);
      setError(err instanceof Error ? err.message : "Failed to save preferences.");
      setSaveStatus("error");
    }
  }, []);

  return { preferences, loading, saveStatus, error, save };
}
