-- Stores every inbound Ring webhook event: the raw payload as received (for
-- audit/debugging) plus the fields already normalized into PrismEvent.
CREATE TABLE IF NOT EXISTS ring_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  snapshot_url TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
