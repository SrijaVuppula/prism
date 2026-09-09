-- Enable pgvector up front so the repeat-visitor similarity search
-- (see src/db/vectorStore.ts) doesn't need a retrofit migration later.
CREATE EXTENSION IF NOT EXISTS vector;
