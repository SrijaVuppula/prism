-- Per-household alert preferences (see src/preferences/preferencesStore.ts):
-- haptic pattern overrides, quiet hours, and the known-visitor-tagging
-- opt-in. household_id is a real column (not folded away as a singleton)
-- so a future move to per-user auth is a call-site change, not a schema
-- migration -- see preferencesStore.ts's module comment for why.
CREATE TABLE IF NOT EXISTS user_preferences (
  household_id TEXT PRIMARY KEY,
  haptic_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start_utc SMALLINT NOT NULL DEFAULT 22,
  quiet_hours_end_utc SMALLINT NOT NULL DEFAULT 6,
  known_visitor_tagging_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quiet_hours_start_utc_range CHECK (quiet_hours_start_utc BETWEEN 0 AND 23),
  CONSTRAINT quiet_hours_end_utc_range CHECK (quiet_hours_end_utc BETWEEN 0 AND 23)
);
