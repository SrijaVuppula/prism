import { describe, expect, it, vi } from "vitest";
import { RingApiError, RingClient } from "../../src/ring/ringClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("RingClient.listDevices", () => {
  it("calls GET /v1/devices with the Bearer token and maps the JSON:API resources", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "ava1.ring.device.a", type: "devices", attributes: { name: "Front Door", online: true } },
          { id: "ava1.ring.device.b", type: "devices", attributes: { description: "Backyard", online: false } },
          { id: "ava1.ring.device.c", type: "devices", attributes: {} },
          { type: "devices", attributes: { name: "No id, skipped" } },
        ],
      }),
    );
    const client = new RingClient("token-123", "https://api.example.test", fetchImpl);

    const devices = await client.listDevices();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.example.test/v1/devices");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-123" });
    expect(devices).toEqual([
      { id: "ava1.ring.device.a", name: "Front Door", online: true },
      { id: "ava1.ring.device.b", name: "Backyard", online: false },
      { id: "ava1.ring.device.c", name: "Ring device" },
    ]);
  });

  it("returns no devices when the response has no data array", async () => {
    const client = new RingClient("t", "https://api.example.test", vi.fn().mockResolvedValue(jsonResponse({})));
    expect(await client.listDevices()).toEqual([]);
  });

  it("explains a 401 as a missing, expired or revoked token", async () => {
    const client = new RingClient("expired", "https://api.example.test", vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    const error = await client.listDevices().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RingApiError);
    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).toMatch(/expired/);
  });

  it("wraps network failures and non-JSON bodies in RingApiError", async () => {
    const offline = new RingClient("t", "https://api.example.test", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(offline.listDevices()).rejects.toThrow(/ECONNRESET/);

    const notJson = new RingClient(
      "t",
      "https://api.example.test",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })),
    );
    await expect(notJson.listDevices()).rejects.toBeInstanceOf(RingApiError);
  });
});

describe("RingClient.downloadImage", () => {
  it("POSTs an at_timestamp request and returns the image the redirect leads to", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { "Content-Type": "image/jpeg" } }));
    const client = new RingClient("token-123", "https://api.example.test", fetchImpl);

    const image = await client.downloadImage("ava1.ring.device.a", 1786715596787);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.example.test/v1/devices/ava1.ring.device.a/media/image/download");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token-123", "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      type: "at_timestamp",
      timestamp: 1786715596787,
      image_options: { format: "jpeg" },
    });
    expect(image).toEqual({ bytes: Buffer.from([0xff, 0xd8, 0xff]), mediaType: "image/jpeg" });
  });

  it("names the camera module on a multi-camera device", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(Buffer.from([1]), { status: 200 }));
    const client = new RingClient("t", "https://api.example.test", fetchImpl);

    const image = await client.downloadImage("dev", 1, "1");

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).components).toEqual([{ component_id: "1" }]);
    expect(image.mediaType).toBe("image/jpeg");
  });

  it("reports Ring's error code, e.g. a recording that isn't ready yet", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ errors: [{ status: "425", code: "RECORDING_NOT_READY", detail: "not yet" }] }, 425),
    );
    const client = new RingClient("t", "https://api.example.test", fetchImpl);

    const error = await client.downloadImage("dev", 1).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RingApiError);
    expect(error).toMatchObject({ status: 425, code: "RECORDING_NOT_READY" });
  });
});

describe("RingClient account linking calls", () => {
  it("reads the Account ID from GET /v1/users/me", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { type: "users", id: "ava1.ring.account.XXXYYY", attributes: { first_name: "J" } } }),
    );
    const client = new RingClient("t", "https://api.example.test", fetchImpl);

    expect(await client.getAccountId()).toBe("ava1.ring.account.XXXYYY");
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.example.test/v1/users/me");

    fetchImpl.mockResolvedValue(jsonResponse({ data: {} }));
    await expect(client.getAccountId()).rejects.toThrow(/no account id/);
  });

  it("confirms the link with the nonce, then marks the integration completed", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { type: "app-integrations", attributes: { status: "awaiting" } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { type: "app-integrations", attributes: { status: "completed" } } }));
    const client = new RingClient("t", "https://api.example.test", fetchImpl);

    await client.completeAccountLink("nonce-1");

    const [[postUrl, post], [patchUrl, patch]] = fetchImpl.mock.calls;
    expect(String(postUrl)).toBe("https://api.example.test/v1/accounts/me/app-integrations");
    expect(post.method).toBe("POST");
    expect(JSON.parse(post.body)).toEqual({ nonce: "nonce-1" });
    expect(String(patchUrl)).toBe("https://api.example.test/v1/accounts/me/app-integrations");
    expect(patch.method).toBe("PATCH");
    expect(JSON.parse(patch.body)).toEqual({ status: "completed" });
  });

  it("doesn't mark the integration completed when Ring rejects the nonce", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ status: "400", title: "Invalid Nonce" }] }, 400));
    const client = new RingClient("t", "https://api.example.test", fetchImpl);

    await expect(client.completeAccountLink("bad")).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
