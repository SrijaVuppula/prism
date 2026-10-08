import { describe, expect, it, vi } from "vitest";
import { RingTokenStore, type RingAccountTokens } from "../../src/ring/tokenStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const ROW = {
  account_id: "acct_1",
  access_token: "at-1",
  refresh_token: "rt-1",
  expires_at: new Date("2030-01-01T00:00:00.000Z"),
  status: "linked",
};

describe("RingTokenStore", () => {
  it("stores a newly exchanged pair as unclaimed, replacing any earlier link", async () => {
    const pool = fakePool();
    await new RingTokenStore(pool).saveUnclaimed("acct_1", { accessToken: "at", refreshToken: "rt", expiresAt: 1000 });

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(account_id\) DO UPDATE/);
    expect(sql).toMatch(/status = 'unclaimed'/);
    expect(params).toEqual(["acct_1", "at", "rt", 1000]);
  });

  it("maps rows to account tokens", async () => {
    const store = new RingTokenStore(fakePool([ROW]));
    expect(await store.get("acct_1")).toEqual({
      accountId: "acct_1",
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: ROW.expires_at.getTime(),
      status: "linked",
    });
    expect(await new RingTokenStore(fakePool([])).getLatestLinked()).toBeNull();
  });

  it("lists only unclaimed accounts and marks one linked", async () => {
    const pool = fakePool([{ ...ROW, status: "unclaimed" }]);
    const store = new RingTokenStore(pool);

    expect((await store.listUnclaimed())[0].status).toBe("unclaimed");
    expect(pool.query.mock.calls[0][0]).toMatch(/WHERE status = 'unclaimed'/);

    await store.markLinked("acct_1");
    expect(pool.query.mock.calls[1]).toEqual([expect.stringMatching(/SET status = 'linked'/), ["acct_1"]]);
  });

  describe("getValidAccessToken", () => {
    const account = (expiresAt: number): RingAccountTokens => ({
      accountId: "acct_1",
      accessToken: "at-old",
      refreshToken: "rt-old",
      expiresAt,
      status: "linked",
    });

    it("uses the stored token while it's not close to expiring", async () => {
      const refresh = vi.fn();
      const store = new RingTokenStore(fakePool(), refresh);
      expect(await store.getValidAccessToken(account(Date.now() + 3_600_000))).toBe("at-old");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("refreshes and stores a new pair when the token is about to expire", async () => {
      const pool = fakePool();
      const refresh = vi.fn().mockResolvedValue({ accessToken: "at-new", refreshToken: "rt-new", expiresAt: 5000 });
      const store = new RingTokenStore(pool, refresh);

      expect(await store.getValidAccessToken(account(Date.now() + 30_000))).toBe("at-new");
      expect(refresh).toHaveBeenCalledWith("rt-old");
      expect(pool.query.mock.calls[0][1]).toEqual(["acct_1", "at-new", "rt-new", 5000]);
    });
  });
});
