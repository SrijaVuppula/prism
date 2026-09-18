// Fetches and saves the household's alert preferences
// (prism-backend/src/preferences/routes.ts): haptic pattern overrides,
// quiet hours, and the known-visitor-tagging opt-in. Used by
// SettingsPanel, and by ContextCard indirectly (via HomePage) to decide
// whether to offer the opt-in "tag this visitor" control at all.

import { useCallback, useEffect, useState } from "react";
import { resolveApiBase } from "../lib/apiBase";
import type { UserPreferences } from "../types";

export const DEFAULT_PREFERENCES: UserPreferences = {
  hapticOverrides: {},
  quietHours: { enabled: false, startHourUtc: 22, endHourUtc: 6 },
  knownVisitorTaggingEnabled: false,
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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

    (async () => {
      try {
        const response = await fetch(`${resolveApiBase()}/preferences`);
        if (!response.ok) throw new Error(`Failed to load preferences (${response.status})`);
        const data = (await response.json()) as UserPreferences;
        if (!cancelled) setPreferences(data);
      } catch (err) {
        console.error("[preferences] failed to load:", err);
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preferences.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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
