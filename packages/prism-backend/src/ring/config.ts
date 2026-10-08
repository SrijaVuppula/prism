// Configuration for the Ring integration: the app credentials Ring issues
// when the app is created in the Ring Developer Portal, the API base URL,
// and optional access settings. Everything comes from environment variables
// so a missing value fails fast and loudly at first use rather than as an
// obscure downstream error, and so staging vs. production credentials never
// need a code change.

export interface RingClientCredentials {
  clientId: string;
  clientSecret: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Client ID and secret, used for Ring OAuth token exchange and refresh. */
export function getRingClientCredentials(): RingClientCredentials {
  return {
    clientId: requireEnv("RING_CLIENT_ID"),
    clientSecret: requireEnv("RING_CLIENT_SECRET"),
  };
}

/**
 * The app's HMAC signing key (RING_WEBHOOK_SECRET). Ring signs webhooks
 * with it and computes account-linking nonces with it. The webhook receiver
 * only needs this, so it keeps working (e.g. with the local event
 * simulator) before any other Ring credentials are configured.
 */
export function getRingWebhookSecret(): string {
  return requireEnv("RING_WEBHOOK_SECRET");
}

/**
 * Passcode for the sign-in step on Prism's Account Link page, which Ring
 * requires before a link completes. Prism has no user accounts, so the
 * household proves it's them with this. Null when unset, which leaves
 * account linking disabled.
 */
export function getRingLinkPasscode(): string | null {
  return process.env.RING_LINK_PASSCODE || null;
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
 * A fixed access token for Ring API calls, such as one generated in the Ring
 * Developer Playground (valid for about 30 minutes), or null when none is
 * set. When set it's used instead of a linked account's tokens (see
 * accessTokens.ts).
 */
export function getRingAccessToken(): string | null {
  return process.env.RING_ACCESS_TOKEN || null;
}
