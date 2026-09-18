-- Opt-in known-visitor tags (docs/ACCESSIBILITY.md's known-visitor tagging
-- privacy note): a household-supplied label ("Mail carrier", "Neighbor")
-- for a visitor_group_id from event_embeddings. Only consulted when
-- user_preferences.known_visitor_tagging_enabled is true (see 0006).
CREATE TABLE IF NOT EXISTS known_visitor_tags (
  visitor_group_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tagged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
