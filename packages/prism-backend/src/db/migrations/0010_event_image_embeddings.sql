-- Optional per-event image embedding for repeat-visitor matching (see
-- src/bedrock/repeatVisitorMemory.ts). Filled only when an image embedding
-- model is configured (BEDROCK_IMAGE_EMBEDDING_MODEL_ID); NULL otherwise.
-- The width matches IMAGE_EMBEDDING_DIMENSIONS in src/bedrock/config.ts.
ALTER TABLE event_embeddings ADD COLUMN image_embedding vector(1024);
