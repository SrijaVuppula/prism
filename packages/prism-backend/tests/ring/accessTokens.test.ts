import { afterEach, describe, expect, it, vi } from "vitest";
import { getRingApiToken } from "../../src/ring/accessTokens";
import type { RingAccountTokens } from "../../src/ring/tokenStore";

const LINKED: RingAccountTokens = { accountId: "acct_1", accessToken: "at", refreshToken: "rt", expiresAt: 0, status: "linked" };

function store(account: RingAccountTokens | null) {
  return {
    get: vi.fn().mockResolvedValue(account),
    getLatestLinked: vi.fn().mockResolvedValue(account),
    getValidAccessToken: vi.fn().mockResolvedValue("valid-token"),
  };
}

afterEach(() => {
  delete process.env.RING_ACCESS_TOKEN;
});

describe("getRingApiToken", () => {
  it("prefers RING_ACCESS_TOKEN when it's set", async () => {
    process.env.RING_ACCESS_TOKEN = "playground-token";
    const target = store(LINKED);
    expect(await getRingApiToken("acct_1", target)).toBe("playground-token");
    expect(target.get).not.toHaveBeenCalled();
  });

  it("uses the given account's token, refreshed if needed", async () => {
    const target = store(LINKED);
    expect(await getRingApiToken("acct_1", target)).toBe("valid-token");
    expect(target.get).toHaveBeenCalledWith("acct_1");
    expect(target.getValidAccessToken).toHaveBeenCalledWith(LINKED);
  });

  it("uses the most recently linked account when none is given", async () => {
    const target = store(LINKED);
    expect(await getRingApiToken(undefined, target)).toBe("valid-token");
    expect(target.getLatestLinked).toHaveBeenCalled();
  });

  it("returns null for an unknown or not yet linked account", async () => {
    expect(await getRingApiToken("acct_x", store(null))).toBeNull();
    expect(await getRingApiToken("acct_1", store({ ...LINKED, status: "unclaimed" }))).toBeNull();
  });
});
