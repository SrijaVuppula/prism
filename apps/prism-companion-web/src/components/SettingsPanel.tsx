// Settings UI for the household's alert preferences: quiet hours, the
// known-visitor-tagging opt-in (with its privacy disclosure inline, per
// docs/ACCESSIBILITY.md), and per-Signal-Class haptic pattern overrides.
// A plain form bound to usePreferences -- no separate "draft" state library,
// just local component state seeded from the loaded preferences and PUT on
// submit.

import { useEffect, useState } from "react";
import type { SignalClass } from "prism-alert-engine";
import { usePreferences } from "../hooks/usePreferences";
import type { UserPreferences } from "../types";

const SIGNAL_CLASSES: SignalClass[] = ["Routine", "Notable", "Urgent"];
const DEFAULT_PATTERN_HINT: Record<SignalClass, string> = {
  Routine: "100",
  Notable: "150, 100, 150",
  Urgent: "300, 150, 300, 150, 300",
};

function patternToText(pattern?: number[]): string {
  return pattern ? pattern.join(", ") : "";
}

function textToPattern(text: string): number[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const values = trimmed
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length > 0 ? values : undefined;
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { preferences, loading, saveStatus, error, save } = usePreferences();
  const [draft, setDraft] = useState<UserPreferences>(preferences);

  useEffect(() => {
    if (!loading) setDraft(preferences);
  }, [loading, preferences]);

  if (loading) {
    return (
      <section className="settings-panel" aria-label="Settings">
        <p role="status">Loading settings…</p>
      </section>
    );
  }

  return (
    <section className="settings-panel" aria-label="Settings">
      <div className="settings-panel__header">
        <h2>Settings</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(draft);
        }}
      >
        <fieldset className="settings-panel__section">
          <legend>Quiet hours</legend>
          <label className="settings-panel__checkbox">
            <input
              type="checkbox"
              checked={draft.quietHours.enabled}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, quietHours: { ...prev.quietHours, enabled: e.target.checked } }))
              }
            />
            Reduce alert urgency during quiet hours
          </label>
          <div className="settings-panel__row">
            <label>
              Start (UTC hour)
              <input
                type="number"
                min={0}
                max={23}
                value={draft.quietHours.startHourUtc}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    quietHours: { ...prev.quietHours, startHourUtc: Number(e.target.value) },
                  }))
                }
              />
            </label>
            <label>
              End (UTC hour)
              <input
                type="number"
                min={0}
                max={23}
                value={draft.quietHours.endHourUtc}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    quietHours: { ...prev.quietHours, endHourUtc: Number(e.target.value) },
                  }))
                }
              />
            </label>
          </div>
        </fieldset>

        <fieldset className="settings-panel__section">
          <legend>Known-visitor tagging</legend>
          <label className="settings-panel__checkbox">
            <input
              type="checkbox"
              checked={draft.knownVisitorTaggingEnabled}
              onChange={(e) => setDraft((prev) => ({ ...prev, knownVisitorTaggingEnabled: e.target.checked }))}
            />
            Let me tag repeat visitors by name (e.g. "Mail carrier")
          </label>
          <p className="settings-panel__disclosure">
            Opt-in only. Tags are stored on this household's own backend and are never uploaded or shared anywhere
            else. Turning this off stops new tagging but doesn't delete tags already saved.
          </p>
        </fieldset>

        <fieldset className="settings-panel__section">
          <legend>Haptic pattern overrides</legend>
          <p className="settings-panel__hint">Comma-separated on/off durations in milliseconds. Leave blank to use the default pattern.</p>
          {SIGNAL_CLASSES.map((signalClass) => (
            <label key={signalClass} className="settings-panel__row">
              {signalClass}
              <input
                type="text"
                placeholder={DEFAULT_PATTERN_HINT[signalClass]}
                value={patternToText(draft.hapticOverrides[signalClass])}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    hapticOverrides: { ...prev.hapticOverrides, [signalClass]: textToPattern(e.target.value) },
                  }))
                }
              />
            </label>
          ))}
        </fieldset>

        <div className="settings-panel__actions">
          <button type="submit" disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Saving…" : "Save settings"}
          </button>
          <p className="settings-panel__save-status" role="status">
            {saveStatus === "saved" && "Saved."}
            {saveStatus === "error" && (error ?? "Failed to save.")}
          </p>
        </div>
      </form>
    </section>
  );
}
