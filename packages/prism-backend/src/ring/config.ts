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
    webhookSecret: getRingWebhookSecret(),
    scope: process.env.RING_OAUTH_SCOPE,
  };
}

/**
 * Just the webhook signing secret. The webhook receiver only needs this, so
 * it keeps working (e.g. with the local event simulator) before any OAuth
 * credentials are configured.
 */
export function getRingWebhookSecret(): string {
  return requireEnv("RING_WEBHOOK_SECRET");
}

/**
 * Base URL of the Ring Partner API. The default is the endpoint Ring's own
 * sample app calls (github.com/AmazonAppDev/ring-api-helloworld).
 */
export const DEFAULT_RING_API_BASE_URL = "https://api.amazonvision.com";

export function getRingApiBaseUrl(): string {
  return process.env.RING_API_BASE_URL || DEFAULT_RING_API_BASE_URL;
}

/**
 * Access token for Ring API calls, such as one generated in the Ring
 * Developer Playground (valid for about 30 minutes), or null when none is
 * configured. Optional: without it Prism runs on webhook data alone.
 */
export function getRingAccessToken(): string | null {
  return process.env.RING_ACCESS_TOKEN || null;
}
