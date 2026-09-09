// Configuration for the Ring OAuth account-linking flow and webhook receiver.
// Everything here comes from environment variables so a missing value fails
// fast and loudly at startup/first-use rather than as an obscure downstream
// error, and so sandbox vs. production credentials never need a code change.

export interface RingConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Account Link URL (OAuth authorization endpoint) issued for this partner integration. */
  authorizeUrl: string;
  /** Token Exchange URL (OAuth token endpoint) issued for this partner integration. */
  tokenUrl: string;
  webhookSecret: string;
  /** Optional OAuth scope string; only set this if the partner agreement specifies one. */
  scope?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getRingConfig(): RingConfig {
  return {
    clientId: requireEnv("RING_CLIENT_ID"),
    clientSecret: requireEnv("RING_CLIENT_SECRET"),
    redirectUri: requireEnv("RING_REDIRECT_URI"),
    authorizeUrl: requireEnv("RING_AUTHORIZE_URL"),
    tokenUrl: requireEnv("RING_TOKEN_URL"),
    webhookSecret: requireEnv("RING_WEBHOOK_SECRET"),
    scope: process.env.RING_OAUTH_SCOPE,
  };
}
