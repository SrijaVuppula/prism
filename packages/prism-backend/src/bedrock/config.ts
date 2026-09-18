// Configuration for Bedrock Runtime calls (multimodal classification,
// embeddings). Same pattern as ring/config.ts: env-driven so a missing
// value fails fast and loudly, and so no region or model id is ever
// guessed in code.
//
// AWS credentials themselves are intentionally not part of this config --
// they come from the standard SDK credential provider chain (environment,
// shared config file, or an IAM role), not from application config.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface BedrockConfig {
  region: string;
  /** Bedrock model id for multimodal classification, e.g. an `anthropic.claude-*` id. */
  modelId: string;
}

export function getBedrockConfig(): BedrockConfig {
  return {
    region: requireEnv("BEDROCK_REGION"),
    modelId: requireEnv("BEDROCK_MODEL_ID"),
  };
}

export interface BedrockEmbeddingConfig {
  region: string;
  /** Bedrock embedding model id, e.g. an `amazon.titan-embed-text-*` id. */
  modelId: string;
  /**
   * Output vector dimensionality. Must match the `vector(N)` column width
   * in db/migrations/0005_event_embeddings.sql -- changing the embedding
   * model to one with a different dimension needs a migration, not just an
   * env change.
   */
  dimensions: number;
}

const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export function getBedrockEmbeddingConfig(): BedrockEmbeddingConfig {
  const dimensionsRaw = process.env.BEDROCK_EMBEDDING_DIMENSIONS;
  const dimensions = dimensionsRaw ? Number(dimensionsRaw) : DEFAULT_EMBEDDING_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`BEDROCK_EMBEDDING_DIMENSIONS must be a positive integer, got: ${dimensionsRaw}`);
  }
  return {
    region: requireEnv("BEDROCK_REGION"),
    modelId: requireEnv("BEDROCK_EMBEDDING_MODEL_ID"),
    dimensions,
  };
}
