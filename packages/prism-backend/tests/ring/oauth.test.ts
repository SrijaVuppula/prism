import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAccountLinkUrl,
  exchangeCodeForTokens,
  refreshTokens,
  RingAlreadyLinkedError,
  RingOAuthError,
} from "../../src/ring/oauth";

const ENV = {
  RING_CLIENT_ID: "client-123",
  RING_CLIENT_SECRET: "secret-abc",
  RING_REDIRECT_URI: "https://prism.example.com/auth/ring/callback",
  RING_AUTHORIZE_URL: "https://ring.example.com/oauth/authorize",
  RING_TOKEN_URL: "https://ring.example.com/oauth/token",
  RING_WEBHOOK_SECRET: "webhook-secret",
};

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    delete process.env[key];
  }
  vi.unstubAllGlobals();
});

describe("buildAccountLinkUrl", () => {
  it("targets the configured Account Link URL with the expected params", () => {
    const url = new URL(buildAccountLinkUrl("state-xyz"));
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(ENV.RING_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(ENV.RING_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(ENV.RING_REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("includes scope when RING_OAUTH_SCOPE is set", () => {
    process.env.RING_OAUTH_SCOPE = "history";
    const url = new URL(buildAccountLinkUrl("state-xyz"));
    expect(url.searchParams.get("scope")).toBe("history");
  });
});

describe("exchangeCodeForTokens", () => {
  it("posts an authorization_code grant to the Token Exchange URL and returns tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
    const tokens = await exchangeCodeForTokens("auth-code");

    expect(tokens.accessToken).toBe("at");
    expect(tokens.refreshToken).toBe("rt");
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ENV.RING_TOKEN_URL);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("client_id")).toBe(ENV.RING_CLIENT_ID);
  });

  it("throws RingAlreadyLinkedError when Ring reports the account is already linked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: "already_linked" }),
      }),
    );

    await expect(exchangeCodeForTokens("auth-code")).rejects.toBeInstanceOf(
      RingAlreadyLinkedError,
    );
  });

  it("throws a generic RingOAuthError on other failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "server_error" }),
      }),
    );

    await expect(exchangeCodeForTokens("auth-code")).rejects.toBeInstanceOf(RingOAuthError);
  });

  it("throws when the token response is missing required fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "at" }),
      }),
    );

    await expect(exchangeCodeForTokens("auth-code")).rejects.toBeInstanceOf(RingOAuthError);
  });
});

describe("refreshTokens", () => {
  it("posts a refresh_token grant to the Token Exchange URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await refreshTokens("old-refresh-token");
    expect(tokens.accessToken).toBe("at2");

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
  });
});
