import { beforeEach, describe, expect, it, vi } from "vitest";
import { RingApiError } from "../../src/ring/ringClient";
import {
  isRingSnapshotUrl,
  parseRingSnapshotUrl,
  RingSnapshotLoader,
  ringSnapshotUrl,
} from "../../src/ring/snapshots";

const IMAGE = { bytes: Buffer.from([0xff, 0xd8]), mediaType: "image/jpeg" };

describe("ring:// snapshot references", () => {
  it("round-trips device, moment, account and camera module", () => {
    const ref = { deviceId: "ava1.ring.device.a/b", timestamp: 1786715596787, accountId: "ava1.ring.account.x", componentId: "0" };
    const url = ringSnapshotUrl(ref);

    expect(isRingSnapshotUrl(url)).toBe(true);
    expect(parseRingSnapshotUrl(url)).toEqual(ref);
  });

  it("leaves optional parts out when they're absent", () => {
    expect(parseRingSnapshotUrl(ringSnapshotUrl({ deviceId: "dev", timestamp: 5 }))).toEqual({ deviceId: "dev", timestamp: 5 });
  });

  it("rejects anything that isn't a well-formed reference", () => {
    for (const value of [
      "https://cdn.example.com/a.jpg",
      "file:///tmp/a.jpg",
      "ring://devices/dev/snapshot",
      "ring://devices/dev/snapshot?at=abc",
      "ring://other/dev/snapshot?at=5",
    ]) {
      expect(parseRingSnapshotUrl(value)).toBeNull();
    }
  });
});

describe("RingSnapshotLoader", () => {
  const url = ringSnapshotUrl({ deviceId: "dev", timestamp: 1000, accountId: "acct" });
  let downloadImage: ReturnType<typeof vi.fn>;
  let getToken: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;

  function loader() {
    return new RingSnapshotLoader({ getToken, createClient: () => ({ downloadImage }), sleep });
  }

  beforeEach(() => {
    downloadImage = vi.fn().mockResolvedValue(IMAGE);
    getToken = vi.fn().mockResolvedValue("token");
    sleep = vi.fn().mockResolvedValue(undefined);
  });

  it("downloads the frame with a token for the event's account", async () => {
    expect(await loader().load(url)).toEqual(IMAGE);
    expect(getToken).toHaveBeenCalledWith("acct");
    expect(downloadImage).toHaveBeenCalledWith("dev", 1000, undefined);
  });

  it("fails clearly when there's no token to download with", async () => {
    getToken.mockResolvedValue(null);
    await expect(loader().load(url)).rejects.toThrow(/No Ring access token/);
  });

  it("retries while the recording isn't ready, then gives up", async () => {
    const notReady = new RingApiError("not ready", 425, "RECORDING_NOT_READY");
    downloadImage.mockRejectedValueOnce(notReady).mockRejectedValueOnce(notReady).mockResolvedValue(IMAGE);
    expect(await loader().load(url)).toEqual(IMAGE);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);

    downloadImage.mockReset().mockRejectedValue(notReady);
    await expect(loader().load(url)).rejects.toBe(notReady);
    expect(downloadImage).toHaveBeenCalledTimes(5);
  });

  it("doesn't retry other failures", async () => {
    downloadImage.mockRejectedValue(new RingApiError("no media", 416, "MEDIA_NOT_FOUND"));
    await expect(loader().load(url)).rejects.toThrow(/no media/);
    expect(downloadImage).toHaveBeenCalledTimes(1);
  });

  it("downloads each snapshot once, but tries again after a failure", async () => {
    const target = loader();
    await Promise.all([target.load(url), target.load(url)]);
    expect(downloadImage).toHaveBeenCalledTimes(1);

    const other = ringSnapshotUrl({ deviceId: "dev", timestamp: 2000 });
    downloadImage.mockRejectedValueOnce(new RingApiError("busy", 503));
    await expect(target.load(other)).rejects.toThrow(/busy/);
    expect(await target.load(other)).toEqual(IMAGE);
  });
});
