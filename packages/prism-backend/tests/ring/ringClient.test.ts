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
