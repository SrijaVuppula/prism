// Configuration for Web Push delivery. Same env-driven, fail-fast pattern as
// ring/config.ts and bedrock/config.ts: a missing VAPID value fails loudly
// at first use rather than as a mysterious 401 from a push service.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  /** Contact URL push services may use to reach the sender, e.g. "mailto:ops@example.com". */
  subject: string;
}

export function getWebPushConfig(): WebPushConfig {
  return {
    publicKey: requireEnv("VAPID_PUBLIC_KEY"),
    privateKey: requireEnv("VAPID_PRIVATE_KEY"),
    subject: requireEnv("VAPID_SUBJECT"),
  };
}
