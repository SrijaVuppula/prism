// Ring's one-way account linking. Ring releases a user's OAuth tokens to
// Prism before the user has signed in to Prism (token exchange, routes.ts),
// then redirects the user to Prism's Account Link URL with `time` and
// `nonce` query parameters. The nonce is HMAC-SHA256(signing key,
// "<time>:<account_id>"), URL-safe Base64 without padding, so after the
// user signs in Prism recomputes it for each unclaimed token's Account ID:
// the one that matches is the account to link. The redirect is only valid
// for 10 minutes.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { RingAccountTokens } from "./tokenStore";

export const LINK_VALIDATION_WINDOW_MS = 600_000;

export function computeLinkNonce(time: string, accountId: string, signingKey: string): string {
  return createHmac("sha256", signingKey).update(`${time}:${accountId}`, "utf8").digest("base64url");
}

/** Why a link redirect's `time` can't be used, or null when it's within the 10-minute window. */
export function linkTimeProblem(time: string, now: number = Date.now()): string | null {
  if (!/^\d+$/.test(time)) return "The link is missing its timestamp.";
  const age = now - Number(time);
  if (age < 0) return "The link's timestamp is in the future.";
  if (age > LINK_VALIDATION_WINDOW_MS) return "The link has expired. Start again from the Ring app.";
  return null;
}

function equalStrings(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The unclaimed account whose Account ID the nonce was computed for, if any. */
export function findAccountForNonce(
  nonce: string,
  time: string,
  unclaimed: RingAccountTokens[],
  signingKey: string,
): RingAccountTokens | null {
  return unclaimed.find((account) => equalStrings(computeLinkNonce(time, account.accountId, signingKey), nonce)) ?? null;
}

/** Constant-time check of the household passcode entered on the Account Link page. */
export function passcodeMatches(entered: string, expected: string): boolean {
  return equalStrings(entered, expected);
}
