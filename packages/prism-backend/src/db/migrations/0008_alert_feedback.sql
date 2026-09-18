-- Thumbs up/down feedback on a dispatched alert's classification (see
-- src/feedback/feedbackStore.ts). category/signal_class/signal_score are
-- stored denormalized at vote time -- ring_events has no classification/
-- scoring columns (those are computed transiently in the pipeline, not
-- persisted), and the companion app already has this event's classification
-- and scoring in hand from the WebSocket message it rendered, so there's no
-- need to widen the already-tested ring_events schema just to look it back up.
--
-- One vote per event: a changed mind overwrites rather than accumulating.
CREATE TABLE IF NOT EXISTS alert_feedback (
  event_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  signal_class TEXT NOT NULL,
  signal_score SMALLINT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feedback loop (src/feedback/weightAdjustment.ts) aggregates votes per
-- category to derive a scoring bias.
CREATE INDEX IF NOT EXISTS alert_feedback_category_vote_idx
  ON alert_feedback (category, vote);
