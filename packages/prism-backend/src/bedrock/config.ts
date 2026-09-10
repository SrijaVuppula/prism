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
