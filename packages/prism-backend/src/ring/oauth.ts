// Ring OAuth 2.0 account-linking flow: Account Link URL, Token Exchange URL,
// and refresh-token handling.
//
// Ring enforces one active link per user per app: relinking an account that
// is already linked (to this app or another) is rejected by the token
// endpoint rather than silently re-issued. That case is surfaced here as
// RingAlreadyLinkedError so callers can show a clear message instead of a
// raw API error.

import { getRingConfig } from "./config";

export interface RingTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export class RingOAuthError extends Error {
  constructor(message: string, public readonly ringErrorCode?: string) {
    super(message);
    this.name = "RingOAuthError";
  }
}

export class RingAlreadyLinkedError extends RingOAuthError {
  constructor() {
    super(
      "This Ring account is already linked to a Prism account. Unlink it before relinking.",
      "already_linked",
    );
    this.name = "RingAlreadyLinkedError";
  }
}

/** Ring error codes that mean "already linked" rather than a generic failure. */
const ALREADY_LINKED_ERROR_CODES = new Set(["already_linked", "account_already_linked"]);

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Builds the Account Link URL the user is redirected to in order to grant Prism access to their Ring account. */
export function buildAccountLinkUrl(state: string): string {
  const config = getRingConfig();
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (config.scope) {
    url.searchParams.set("scope", config.scope);
  }
  return url.toString();
}

async function postToTokenExchangeUrl(body: URLSearchParams): Promise<RingTokens> {
  const config = getRingConfig();

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  let payload: TokenResponseBody | undefined;
  try {
    payload = (await response.json()) as TokenResponseBody;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorCode = payload?.error;
    if (errorCode && ALREADY_LINKED_ERROR_CODES.has(errorCode)) {
      throw new RingAlreadyLinkedError();
    }
    throw new RingOAuthError(
      `Ring token endpoint returned ${response.status}${
        payload?.error_description ? `: ${payload.error_description}` : ""
      }`,
      errorCode,
    );
  }

  if (!payload?.access_token || !payload?.refresh_token || typeof payload.expires_in !== "number") {
    throw new RingOAuthError("Ring token endpoint response is missing required fields");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  };
}

/** Exchanges an authorization code from the Account Link redirect for an access/refresh token pair. */
export async function exchangeCodeForTokens(code: string): Promise<RingTokens> {
  const config = getRingConfig();
  return postToTokenExchangeUrl(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  );
}

/** Exchanges a refresh token for a new access/refresh token pair. Ring rotates the refresh token on each use. */
export async function refreshTokens(refreshToken: string): Promise<RingTokens> {
  const config = getRingConfig();
  return postToTokenExchangeUrl(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  );
}
