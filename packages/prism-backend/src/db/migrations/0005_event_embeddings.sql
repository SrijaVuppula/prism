-- Stores one embedding vector per classified event, for repeat-visitor
-- similarity search (see src/db/vectorStore.ts). visitor_group_id clusters
-- a run of visually-similar events together so a repeat visit can be
-- counted and, when the household has opted in (see 0006 known_visitor_tags),
-- tagged as a known visitor.
--
-- Dimension is fixed at 1024 to match the default Bedrock embedding model
-- (see src/bedrock/config.ts's getBedrockEmbeddingConfig). Switching to a
-- model with a different output dimension needs a new migration.
CREATE TABLE IF NOT EXISTS event_embeddings (
  event_id TEXT PRIMARY KEY REFERENCES ring_events(id),
  device_id TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  visitor_group_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Repeat-visitor lookups always scope to one device within a recent time
-- window before ranking by vector distance.
CREATE INDEX IF NOT EXISTS event_embeddings_device_created_at_idx
  ON event_embeddings (device_id, created_at);

-- Counting occurrences within a visitor group is a second query per lookup.
CREATE INDEX IF NOT EXISTS event_embeddings_visitor_group_idx
  ON event_embeddings (visitor_group_id);
