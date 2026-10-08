import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logRingConnection, RingDeviceDirectory } from "../../src/ring/deviceDirectory";

const FRONT_DOOR = { id: "dev_1", name: "Front Door" };

let now: number;
let listDevices: ReturnType<typeof vi.fn>;
let createClient: ReturnType<typeof vi.fn>;

function directory(token: string | null = "token") {
  return new RingDeviceDirectory(
    async () => token,
    createClient,
    () => now,
  );
}

beforeEach(() => {
  now = 1_000_000;
  listDevices = vi.fn().mockResolvedValue([FRONT_DOOR]);
  createClient = vi.fn(() => ({ listDevices }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RingDeviceDirectory.lookup", () => {
  it("makes no Ring call without an access token", async () => {
    expect(await directory(null).lookup("dev_1")).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("finds a device by id and caches the list for ten minutes", async () => {
    const target = directory();

    expect(await target.lookup("dev_1")).toEqual(FRONT_DOOR);
    expect(await target.lookup("dev_unknown")).toBeNull();
    now += 9 * 60_000;
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(1);

    now += 2 * 60_000;
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent lookups", async () => {
    const target = directory();
    await Promise.all([target.lookup("dev_1"), target.lookup("dev_1"), target.lookup("dev_2")]);
    expect(listDevices).toHaveBeenCalledTimes(1);
  });

  it("never throws, waits a minute after a failure, and keeps serving the last good list", async () => {
    const target = directory();
    await target.lookup("dev_1");
    now += 11 * 60_000;
    listDevices.mockRejectedValue(new Error("Ring API GET /v1/devices returned 401"));

    expect(await target.lookup("dev_1")).toEqual(FRONT_DOOR);
    expect(console.error).toHaveBeenCalledTimes(1);

    now += 30_000;
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(2);

    now += 31_000;
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(3);
  });
});

describe("RingDeviceDirectory.refresh", () => {
  it("throws without Ring access", async () => {
    await expect(directory(null).refresh()).rejects.toThrow(/link a Ring account or set RING_ACCESS_TOKEN/);
  });

  it("forgets the cached list when invalidated", async () => {
    const target = directory();
    await target.lookup("dev_1");
    target.invalidate();
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(2);
  });

  it("returns the list and fills the cache", async () => {
    const target = directory();
    expect(await target.refresh()).toEqual([FRONT_DOOR]);
    await target.lookup("dev_1");
    expect(listDevices).toHaveBeenCalledTimes(1);
  });
});

describe("logRingConnection", () => {
  it("says the Ring API isn't used when there's no Ring access", async () => {
    await logRingConnection(directory(null), async () => null);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/no linked Ring account or RING_ACCESS_TOKEN/));
    expect(listDevices).not.toHaveBeenCalled();
  });

  it("logs the device names when the token works, and the error when it doesn't", async () => {
    await logRingConnection(directory(), async () => "token");
    expect(console.log).toHaveBeenCalledWith("[ring] Ring API connected: 1 device(s): Front Door");

    listDevices.mockRejectedValue(new Error("Ring API GET /v1/devices returned 401"));
    await logRingConnection(directory(), async () => "token");
    expect(console.error).toHaveBeenCalledWith("[ring] Ring API check failed:", "Ring API GET /v1/devices returned 401");
  });
});
