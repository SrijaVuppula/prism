import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getAccountId = vi.fn();
const completeAccountLink = vi.fn();

vi.mock("../../src/bedrock/agentOrchestration", () => ({ runPipeline: vi.fn() }));
vi.mock("../../src/db/eventStore", () => ({ getRingEventStore: vi.fn() }));
vi.mock("../../src/ring/oauth", () => ({ exchangeCodeForTokens: vi.fn() }));
vi.mock("../../src/ring/tokenStore", () => ({ getRingTokenStore: vi.fn() }));
vi.mock("../../src/ring/deviceDirectory", () => ({ getRingDeviceDirectory: vi.fn() }));
vi.mock("../../src/ring/ringClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ring/ringClient")>();
  return { ...actual, RingClient: vi.fn().mockImplementation(() => ({ getAccountId, completeAccountLink })) };
});

import { computeLinkNonce } from "../../src/ring/accountLinking";
import { getRingDeviceDirectory } from "../../src/ring/deviceDirectory";
import { exchangeCodeForTokens } from "../../src/ring/oauth";
import { RingClient } from "../../src/ring/ringClient";
import { ringRouter } from "../../src/ring/routes";
import { getRingTokenStore } from "../../src/ring/tokenStore";

const KEY = "fake-signing-key-for-tests";
const PASSCODE = "maple door 42";
const ACCOUNT = { accountId: "ava1.ring.account.XXXYYY", accessToken: "at", refreshToken: "rt", expiresAt: 0, status: "unclaimed" };

let server: Server;
let baseUrl: string;
let store: Record<string, ReturnType<typeof vi.fn>>;
let invalidate: ReturnType<typeof vi.fn>;

function linkParams(time = String(Date.now() - 5_000), accountId = ACCOUNT.accountId) {
  return { time, nonce: computeLinkNonce(time, accountId, KEY) };
}

function postForm(path: string, fields: Record<string, string>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(ringRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  process.env.RING_WEBHOOK_SECRET = KEY;
  process.env.RING_LINK_PASSCODE = PASSCODE;
  store = {
    saveUnclaimed: vi.fn().mockResolvedValue(undefined),
    listUnclaimed: vi.fn().mockResolvedValue([ACCOUNT]),
    getValidAccessToken: vi.fn().mockResolvedValue("fresh-token"),
    markLinked: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(getRingTokenStore).mockReturnValue(store as never);
  invalidate = vi.fn();
  vi.mocked(getRingDeviceDirectory).mockReturnValue({ invalidate } as never);
  vi.mocked(exchangeCodeForTokens).mockReset().mockResolvedValue({ accessToken: "at", refreshToken: "rt", expiresAt: 1 });
  vi.mocked(RingClient)
    .mockReset()
    .mockImplementation(() => ({ getAccountId, completeAccountLink }) as never);
  getAccountId.mockReset().mockResolvedValue(ACCOUNT.accountId);
  completeAccountLink.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.RING_WEBHOOK_SECRET;
  delete process.env.RING_LINK_PASSCODE;
  vi.restoreAllMocks();
});

describe("POST /ring/token-exchange", () => {
  it("exchanges the code Ring sends and stores the tokens, unclaimed, under the Account ID", async () => {
    const response = await fetch(`${baseUrl}/ring/token-exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "code-1" }),
    });

    expect(response.status).toBe(200);
    expect(exchangeCodeForTokens).toHaveBeenCalledWith("code-1");
    expect(RingClient).toHaveBeenCalledWith("at");
    expect(store.saveUnclaimed).toHaveBeenCalledWith(ACCOUNT.accountId, { accessToken: "at", refreshToken: "rt", expiresAt: 1 });
  });

  it("also reads the code from a form body or the query string", async () => {
    expect((await postForm("/ring/token-exchange", { code: "code-2" })).status).toBe(200);
    expect((await fetch(`${baseUrl}/ring/token-exchange?code=code-3`, { method: "POST" })).status).toBe(200);
    expect(vi.mocked(exchangeCodeForTokens).mock.calls.map(([code]) => code)).toEqual(["code-2", "code-3"]);
  });

  it("answers 400 without a code and 502 when the exchange fails, storing nothing", async () => {
    expect((await fetch(`${baseUrl}/ring/token-exchange`, { method: "POST" })).status).toBe(400);

    vi.mocked(exchangeCodeForTokens).mockRejectedValue(new Error("invalid_grant"));
    expect((await postForm("/ring/token-exchange", { code: "expired" })).status).toBe(502);
    expect(store.saveUnclaimed).not.toHaveBeenCalled();
  });
});

describe("GET /ring/link", () => {
  it("shows the sign-in form, carrying the nonce and time", async () => {
    const { time, nonce } = linkParams();
    const response = await fetch(`${baseUrl}/ring/link?${new URLSearchParams({ time, nonce })}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<label for="passcode">');
    expect(html).toContain(`name="nonce" value="${nonce}"`);
    expect(html).toContain(`name="time" value="${time}"`);
  });

  it("escapes what it echoes back", async () => {
    const html = await (await fetch(`${baseUrl}/ring/link?${new URLSearchParams({ time: String(Date.now()), nonce: '"><script>x</script>' })}`)).text();
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&#34;&#62;&#60;script&#62;");
  });

  it("refuses expired links, and linking when no passcode is configured", async () => {
    const expired = linkParams(String(Date.now() - 11 * 60_000));
    const expiredResponse = await fetch(`${baseUrl}/ring/link?${new URLSearchParams(expired)}`);
    expect(expiredResponse.status).toBe(400);
    expect(await expiredResponse.text()).toMatch(/expired/);

    delete process.env.RING_LINK_PASSCODE;
    expect((await fetch(`${baseUrl}/ring/link?${new URLSearchParams(linkParams())}`)).status).toBe(503);
  });
});

describe("POST /ring/link", () => {
  it("after sign-in, matches the nonce, confirms the link with Ring, and marks it linked", async () => {
    const params = linkParams();

    const response = await postForm("/ring/link", { ...params, passcode: PASSCODE });

    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/Ring account linked/);
    expect(store.getValidAccessToken).toHaveBeenCalledWith(ACCOUNT);
    expect(RingClient).toHaveBeenCalledWith("fresh-token");
    expect(completeAccountLink).toHaveBeenCalledWith(params.nonce);
    expect(store.markLinked).toHaveBeenCalledWith(ACCOUNT.accountId);
    expect(invalidate).toHaveBeenCalled();
  });

  it("asks again on a wrong passcode, without touching tokens or Ring", async () => {
    const response = await postForm("/ring/link", { ...linkParams(), passcode: "guess" });

    expect(response.status).toBe(401);
    const html = await response.text();
    expect(html).toContain("That passcode isn&#39;t right.");
    expect(html).toContain('role="alert"');
    expect(store.listUnclaimed).not.toHaveBeenCalled();
    expect(completeAccountLink).not.toHaveBeenCalled();
  });

  it("doesn't link when the nonce matches no unclaimed account, or Ring rejects it", async () => {
    const otherAccount = await postForm("/ring/link", { ...linkParams(undefined, "ava1.ring.account.OTHER"), passcode: PASSCODE });
    expect(otherAccount.status).toBe(400);
    expect(await otherAccount.text()).toMatch(/Ring account not found/);

    completeAccountLink.mockRejectedValue(new Error("400 Invalid Nonce"));
    expect((await postForm("/ring/link", { ...linkParams(), passcode: PASSCODE })).status).toBe(502);
    expect(store.markLinked).not.toHaveBeenCalled();
  });

  it("rejects an expired link even with the right passcode", async () => {
    const response = await postForm("/ring/link", { ...linkParams(String(Date.now() - 11 * 60_000)), passcode: PASSCODE });
    expect(response.status).toBe(400);
    expect(completeAccountLink).not.toHaveBeenCalled();
  });
});

describe("integration lifecycle webhooks", () => {
  it("forgets an account's tokens when the user removes Prism in the Ring app", async () => {
    const body = JSON.stringify({
      meta: { version: "1.1", time: "2026-07-21T07:07:15Z", request_id: "req-1", account_id: ACCOUNT.accountId },
      data: { id: "evt-1", type: "app_integration_removed", attributes: {} },
    });

    const response = await fetch(`${baseUrl}/webhooks/ring`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": `sha256=${createHmac("sha256", KEY).update(body).digest("hex")}`,
      },
      body,
    });

    expect(response.status).toBe(200);
    expect(store.delete).toHaveBeenCalledWith(ACCOUNT.accountId);
    expect(invalidate).toHaveBeenCalled();
  });
});
