import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RingTokens } from "../../src/ring/oauth";

vi.mock("../../src/ring/oauth", async () => {
  const actual = await vi.importActual<typeof import("../../src/ring/oauth")>(
    "../../src/ring/oauth",
  );
  return { ...actual, refreshTokens: vi.fn() };
});

import { refreshTokens } from "../../src/ring/oauth";
import { RingTokenStore } from "../../src/ring/tokenStore";

function fakePool(rows: unknown[]) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

beforeEach(() => {
  vi.mocked(refreshTokens).mockReset();
});

describe("RingTokenStore", () => {
  it("returns the stored access token when it is not close to expiring", async () => {
    const pool = fakePool([
      {
        access_token: "at",
        refresh_token: "rt",
        expires_at: new Date(Date.now() + 3_600_000),
      },
    ]);
    const store = new RingTokenStore(pool);

    const token = await store.getValidAccessToken("user-1");

    expect(token).toBe("at");
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("refreshes and persists a token that is at or near expiry", async () => {
    const pool = fakePool([
      {
        access_token: "at-old",
        refresh_token: "rt-old",
        expires_at: new Date(Date.now() + 1000),
      },
    ]);
    const refreshed: RingTokens = {
      accessToken: "at-new",
      refreshToken: "rt-new",
      expiresAt: Date.now() + 3_600_000,
    };
    vi.mocked(refreshTokens).mockResolvedValue(refreshed);

    const store = new RingTokenStore(pool);
    const token = await store.getValidAccessToken("user-1");

    expect(refreshTokens).toHaveBeenCalledWith("rt-old");
    expect(token).toBe("at-new");
    // First call reads the existing row, second call upserts the refreshed pair.
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("throws when no account is linked", async () => {
    const pool = fakePool([]);
    const store = new RingTokenStore(pool);

    await expect(store.getValidAccessToken("user-1")).rejects.toThrow(
      "No linked Ring account for user user-1",
    );
  });
});
