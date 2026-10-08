import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeCodeForTokens, refreshTokens, RING_OAUTH_TOKEN_URL, RingOAuthError } from "../../src/ring/oauth";

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const TOKENS = { access_token: "at-1", refresh_token: "rt-1", scope: "x", expires_in: 14400, token_type: "Bearer" };

beforeEach(() => {
  process.env.RING_CLIENT_ID = "client-123";
  process.env.RING_CLIENT_SECRET = "secret-abc";
});

afterEach(() => {
  delete process.env.RING_CLIENT_ID;
  delete process.env.RING_CLIENT_SECRET;
});

describe("exchangeCodeForTokens", () => {
  it("POSTs a form-encoded authorization_code grant to Ring's OAuth server", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse(TOKENS));
    const before = Date.now();

    const tokens = await exchangeCodeForTokens("code-xyz", fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://oauth.ring.com/oauth/token");
    expect(RING_OAUTH_TOKEN_URL).toBe(url);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/x-www-form-urlencoded" });
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      grant_type: "authorization_code",
      code: "code-xyz",
      client_id: "client-123",
      client_secret: "secret-abc",
    });
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.refreshToken).toBe("rt-1");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 14400 * 1000);
  });

  it("reports Ring's error, and responses missing tokens", async () => {
    const rejected = vi.fn().mockResolvedValue(
      tokenResponse({ error: "invalid_grant", error_description: "code expired" }, 400),
    );
    const error = await exchangeCodeForTokens("old-code", rejected).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(RingOAuthError);
    expect(error).toMatchObject({ ringErrorCode: "invalid_grant", message: expect.stringMatching(/code expired/) });

    const incomplete = vi.fn().mockResolvedValue(tokenResponse({ access_token: "at" }));
    await expect(exchangeCodeForTokens("code", incomplete)).rejects.toThrow(/missing required fields/);
  });

  it("needs the client credentials", async () => {
    delete process.env.RING_CLIENT_SECRET;
    await expect(exchangeCodeForTokens("code", vi.fn())).rejects.toThrow(/RING_CLIENT_SECRET/);
  });
});

describe("refreshTokens", () => {
  it("POSTs a refresh_token grant and returns the new pair", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(tokenResponse({ ...TOKENS, access_token: "at-2", refresh_token: "rt-2" }));

    const tokens = await refreshTokens("rt-1", fetchImpl);

    expect(Object.fromEntries(fetchImpl.mock.calls[0][1].body as URLSearchParams)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "rt-1",
      client_id: "client-123",
      client_secret: "secret-abc",
    });
    expect(tokens).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2" });
  });
});
