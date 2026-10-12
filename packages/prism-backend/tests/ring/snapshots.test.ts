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
  const EVENT_TIME = 1_786_715_596_787;
  const url = ringSnapshotUrl({ deviceId: "dev", timestamp: EVENT_TIME, accountId: "acct" });
  const mediaNotFound = new RingApiError("no media", 416, "MEDIA_NOT_FOUND");
  const notReady = new RingApiError("not ready", 425, "RECORDING_NOT_READY");
  let downloadImage: ReturnType<typeof vi.fn>;
  let getToken: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;
  let random: ReturnType<typeof vi.fn>;
  let clock: number;

  function loader() {
    return new RingSnapshotLoader({ getToken, createClient: () => ({ downloadImage }), sleep, now: () => clock, random });
  }

  function waits(): number[] {
    return sleep.mock.calls.map(([ms]) => ms);
  }

  beforeEach(() => {
    downloadImage = vi.fn().mockResolvedValue(IMAGE);
    getToken = vi.fn().mockResolvedValue("token");
    // Waiting moves the clock on, as real time would.
    sleep = vi.fn().mockImplementation(async (ms: number) => {
      clock += ms;
    });
    random = vi.fn().mockReturnValue(0);
    // The webhook arrives a couple of seconds after the event.
    clock = EVENT_TIME + 2000;
  });

  it("downloads the frame with a token for the event's account", async () => {
    expect(await loader().load(url)).toEqual(IMAGE);
    expect(getToken).toHaveBeenCalledWith("acct");
    expect(downloadImage).toHaveBeenCalledWith("dev", EVENT_TIME, undefined);
  });

  it("fails clearly when there's no token to download with", async () => {
    getToken.mockResolvedValue(null);
    await expect(loader().load(url)).rejects.toThrow(/No Ring access token/);
  });

  it("retries 416 MEDIA_NOT_FOUND on Ring's schedule, with jitter", async () => {
    random.mockReturnValue(0.5);
    downloadImage.mockRejectedValueOnce(mediaNotFound).mockResolvedValue(IMAGE);
    expect(await loader().load(url)).toEqual(IMAGE);
    expect(waits()).toEqual([5250]);
    expect(downloadImage).toHaveBeenCalledTimes(2);
  });

  it("retries 425 RECORDING_NOT_READY on Ring's schedule", async () => {
    downloadImage.mockRejectedValueOnce(notReady).mockRejectedValueOnce(notReady).mockResolvedValue(IMAGE);
    expect(await loader().load(url)).toEqual(IMAGE);
    expect(waits()).toEqual([5000, 10_000]);
    expect(downloadImage).toHaveBeenCalledTimes(3);
  });

  it("gives up within about 20 seconds, and doesn't cache the failure", async () => {
    random.mockReturnValue(0.99);
    downloadImage.mockRejectedValue(mediaNotFound);
    const target = loader();
    await expect(target.load(url)).rejects.toBe(mediaNotFound);
    // The next scheduled wait (20s) would go past the cap, so it stops there.
    expect(waits()).toEqual([5495, 10_990]);
    expect(waits().reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(20_000);
    expect(downloadImage).toHaveBeenCalledTimes(3);

    // Later, e.g. when the companion app loads the picture, the recording is ready.
    downloadImage.mockReset().mockResolvedValue(IMAGE);
    expect(await target.load(url)).toEqual(IMAGE);
    expect(downloadImage).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry a 416 once the event is more than 2 minutes old", async () => {
    clock = EVENT_TIME + 5 * 60_000;
    downloadImage.mockRejectedValue(mediaNotFound);
    await expect(loader().load(url)).rejects.toBe(mediaNotFound);
    expect(downloadImage).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("doesn't retry other failures", async () => {
    for (const failure of [
      new RingApiError("outside the token's range", 403, "TIME_RANGE_NOT_AUTHORIZED"),
      new RingApiError("busy", 503),
      new RingApiError("network down"),
      new Error("unexpected"),
    ]) {
      downloadImage.mockReset().mockRejectedValue(failure);
      await expect(loader().load(url)).rejects.toBe(failure);
      expect(downloadImage).toHaveBeenCalledTimes(1);
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it("downloads each snapshot once, but tries again after a failure", async () => {
    const target = loader();
    await Promise.all([target.load(url), target.load(url)]);
    expect(downloadImage).toHaveBeenCalledTimes(1);

    const other = ringSnapshotUrl({ deviceId: "dev", timestamp: EVENT_TIME + 1 });
    downloadImage.mockRejectedValueOnce(new RingApiError("busy", 503));
    await expect(target.load(other)).rejects.toThrow(/busy/);
    expect(await target.load(other)).toEqual(IMAGE);
  });
});
