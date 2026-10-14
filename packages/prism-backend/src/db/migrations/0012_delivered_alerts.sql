-- Each alert as it was delivered: the message the companion app received
-- (scored event, channel payloads, device), so the app can show recent
-- alerts after a reload and the catch-up summary can read them (see
-- src/db/alertHistoryStore.ts). The scalar columns are copies for
-- filtering. Deleted with its event.
CREATE TABLE IF NOT EXISTS delivered_alerts (
  event_id TEXT PRIMARY KEY REFERENCES ring_events(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  signal_class TEXT NOT NULL,
  category TEXT NOT NULL,
  message JSONB NOT NULL,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivered_alerts_occurred_at_idx ON delivered_alerts (occurred_at);
