-- Household time zone (an IANA name such as America/New_York). Quiet hours
-- and the late-night factor in the Signal Score are evaluated in this zone,
-- so the quiet-hours columns are renamed: their hours are local to it, not
-- UTC. Existing rows default to UTC, which keeps their quiet hours meaning
-- exactly what they meant before.
ALTER TABLE user_preferences ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE user_preferences RENAME COLUMN quiet_hours_start_utc TO quiet_hours_start_hour;
ALTER TABLE user_preferences RENAME COLUMN quiet_hours_end_utc TO quiet_hours_end_hour;
ALTER TABLE user_preferences RENAME CONSTRAINT quiet_hours_start_utc_range TO quiet_hours_start_hour_range;
ALTER TABLE user_preferences RENAME CONSTRAINT quiet_hours_end_utc_range TO quiet_hours_end_hour_range;
