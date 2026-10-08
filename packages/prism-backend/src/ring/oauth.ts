// Ring OAuth token calls: exchanging the authorization code Ring sends to
// Prism's Token Exchange URL, and refreshing tokens. Both are form-encoded
// POSTs to Ring's OAuth server with the app's client credentials. Access
// tokens last about 4 hours and refresh tokens about 30 days; a refresh
// returns a new pair.

import { getRingClientCredentials } from "./config";

export const RING_OAUTH_TOKEN_URL = "https://oauth.ring.com/oauth/token";

export interface RingTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class RingOAuthError extends Error {
  constructor(
    message: string,
    public readonly ringErrorCode?: string,
  ) {
    super(message);
    this.name = "RingOAuthError";
  }
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function requestTokens(params: Record<string, string>, fetchImpl: typeof fetch): Promise<RingTokens> {
  const { clientId, clientSecret } = getRingClientCredentials();
  const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });

  let response: Response;
  try {
    response = await fetchImpl(RING_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
  } catch (err) {
    throw new RingOAuthError(`Ring token request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let payload: TokenResponseBody | undefined;
  try {
    payload = (await response.json()) as TokenResponseBody;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new RingOAuthError(
      `Ring token endpoint returned ${response.status}${payload?.error_description ? `: ${payload.error_description}` : ""}`,
      payload?.error,
    );
  }
  if (!payload?.access_token || !payload.refresh_token || typeof payload.expires_in !== "number") {
    throw new RingOAuthError("Ring token endpoint response is missing required fields");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

/** Exchanges an authorization code (valid for 60 seconds, single use) for a token pair. */
export function exchangeCodeForTokens(code: string, fetchImpl: typeof fetch = fetch): Promise<RingTokens> {
  return requestTokens({ grant_type: "authorization_code", code }, fetchImpl);
}

/** Exchanges a refresh token for a new access/refresh token pair. */
export function refreshTokens(refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<RingTokens> {
  return requestTokens({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}
