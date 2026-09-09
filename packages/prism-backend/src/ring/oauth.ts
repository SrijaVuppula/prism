// Ring OAuth 2.0 account-link flow.
// TODO: implement Account Link URL, Token Exchange URL, token storage, and
// refresh-token handling per Ring Partner API docs. Also handle Ring's
// "one active link per user per app" constraint — surface a clear error
// state on relink attempts instead of a raw API error.

export interface RingTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function exchangeCodeForTokens(_code: string): Promise<RingTokens> {
  throw new Error("TODO: implement Ring OAuth token exchange");
}

export async function refreshTokens(_refreshToken: string): Promise<RingTokens> {
  throw new Error("TODO: implement Ring OAuth token refresh");
}
