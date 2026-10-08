import { describe, expect, it } from "vitest";
import {
  computeLinkNonce,
  findAccountForNonce,
  LINK_VALIDATION_WINDOW_MS,
  linkTimeProblem,
  passcodeMatches,
} from "../../src/ring/accountLinking";
import type { RingAccountTokens } from "../../src/ring/tokenStore";

const KEY = "fake-signing-key-for-tests";
const TIME = "1771130906289";

function account(accountId: string): RingAccountTokens {
  return { accountId, accessToken: "at", refreshToken: "rt", expiresAt: 0, status: "unclaimed" };
}

describe("computeLinkNonce", () => {
  it("matches Ring's reference algorithm: URL-safe Base64 HMAC-SHA256 of time:account_id, no padding", () => {
    // Computed independently with the Python reference in Ring's docs:
    // base64.urlsafe_b64encode(hmac.new(key.encode(), f"{time}:{account_id}".encode(), sha256).digest()).rstrip(b"=")
    expect(computeLinkNonce(TIME, "ava1.ring.account.XXXYYY", KEY)).toBe("QcqmBR_Z2pTGuP--fSMLC-IDejTvoEpp7YZs71U3zz8");
  });
});

describe("findAccountForNonce", () => {
  it("finds the unclaimed account the nonce was computed for", () => {
    const accounts = [account("ava1.ring.account.AAA"), account("ava1.ring.account.XXXYYY")];
    const nonce = computeLinkNonce(TIME, "ava1.ring.account.XXXYYY", KEY);
    expect(findAccountForNonce(nonce, TIME, accounts, KEY)?.accountId).toBe("ava1.ring.account.XXXYYY");
  });

  it("matches nothing for a different time, key or account", () => {
    const accounts = [account("ava1.ring.account.XXXYYY")];
    const nonce = computeLinkNonce(TIME, "ava1.ring.account.XXXYYY", KEY);
    expect(findAccountForNonce(nonce, "1771130906290", accounts, KEY)).toBeNull();
    expect(findAccountForNonce(nonce, TIME, accounts, "another-key")).toBeNull();
    expect(findAccountForNonce(nonce, TIME, [account("ava1.ring.account.OTHER")], KEY)).toBeNull();
    expect(findAccountForNonce("short", TIME, accounts, KEY)).toBeNull();
  });
});

describe("linkTimeProblem", () => {
  const now = Number(TIME);

  it("accepts a redirect up to 10 minutes old", () => {
    expect(linkTimeProblem(TIME, now)).toBeNull();
    expect(linkTimeProblem(TIME, now + LINK_VALIDATION_WINDOW_MS)).toBeNull();
  });

  it("rejects expired, future and malformed times", () => {
    expect(linkTimeProblem(TIME, now + LINK_VALIDATION_WINDOW_MS + 1)).toMatch(/expired/);
    expect(linkTimeProblem(TIME, now - 1)).toMatch(/future/);
    expect(linkTimeProblem("", now)).toMatch(/missing/);
    expect(linkTimeProblem("12.5", now)).toMatch(/missing/);
  });
});

describe("passcodeMatches", () => {
  it("compares exactly", () => {
    expect(passcodeMatches("open sesame", "open sesame")).toBe(true);
    expect(passcodeMatches("open sesam", "open sesame")).toBe(false);
    expect(passcodeMatches("", "open sesame")).toBe(false);
  });
});
