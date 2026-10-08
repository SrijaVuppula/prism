// Which access token a Ring API call uses: RING_ACCESS_TOKEN when it's set
// (e.g. a short-lived token from the Ring Developer Playground), otherwise
// the token of a Ring account linked to this household, refreshed when it's
// about to expire.

import { getRingAccessToken } from "./config";
import { getRingTokenStore, type RingTokenStore } from "./tokenStore";

/**
 * An access token for the given Ring account, or for the most recently
 * linked account when none is given. Null when there's no token to use
 * (no RING_ACCESS_TOKEN and no matching linked account).
 */
export async function getRingApiToken(
  accountId?: string,
  store: Pick<RingTokenStore, "get" | "getLatestLinked" | "getValidAccessToken"> = getRingTokenStore(),
): Promise<string | null> {
  const fixedToken = getRingAccessToken();
  if (fixedToken) return fixedToken;

  const account = accountId ? await store.get(accountId) : await store.getLatestLinked();
  if (!account || account.status !== "linked") return null;
  return store.getValidAccessToken(account);
}
