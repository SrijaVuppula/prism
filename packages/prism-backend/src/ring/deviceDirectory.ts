// Device names for alerts, looked up with the Ring API. Ring's webhooks
// identify a device by id only; its name ("Front Door") comes from
// GET /v1/devices. The list is cached so a burst of events costs one call,
// and lookups are best-effort: with no access token configured, or when
// Ring can't be reached, an alert just goes out without a Ring device name.

import { getRingAccessToken } from "./config";
import { RingApiError, RingClient, type RingDevice } from "./ringClient";

const CACHE_TTL_MS = 10 * 60_000;
/**
 * After a failed call, how long to wait before asking Ring again, so an
 * expired token doesn't cost a failing request for every event.
 */
const RETRY_AFTER_FAILURE_MS = 60_000;

type DeviceLister = Pick<RingClient, "listDevices">;

export class RingDeviceDirectory {
  private devices: Map<string, RingDevice> | null = null;
  private fetchedAt = 0;
  private failedAt: number | null = null;
  private inFlight: Promise<Map<string, RingDevice> | null> | null = null;

  constructor(
    private readonly getToken: () => string | null = getRingAccessToken,
    private readonly createClient: (token: string) => DeviceLister = (token) => new RingClient(token),
    private readonly now: () => number = Date.now,
  ) {}

  /** The Ring device with this id, or null when it isn't on the account or Ring can't be asked. Never throws. */
  async lookup(deviceId: string): Promise<RingDevice | null> {
    const devices = await this.load();
    return devices?.get(deviceId) ?? null;
  }

  /** Fetches the device list now, bypassing the cache. Unlike lookup(), throws when Ring can't be asked. */
  async refresh(): Promise<RingDevice[]> {
    const token = this.getToken();
    if (!token) {
      throw new RingApiError("RING_ACCESS_TOKEN is not set");
    }
    const list = await this.createClient(token).listDevices();
    this.remember(list);
    return list;
  }

  private load(): Promise<Map<string, RingDevice> | null> {
    const token = this.getToken();
    if (!token) return Promise.resolve(null);

    const now = this.now();
    const fresh = this.devices !== null && now - this.fetchedAt < CACHE_TTL_MS;
    const backingOff = this.failedAt !== null && now - this.failedAt < RETRY_AFTER_FAILURE_MS;
    if (fresh || backingOff) return Promise.resolve(this.devices);

    // Concurrent events share one request.
    this.inFlight ??= this.fetchDevices(token).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async fetchDevices(token: string): Promise<Map<string, RingDevice> | null> {
    try {
      this.remember(await this.createClient(token).listDevices());
    } catch (err) {
      this.failedAt = this.now();
      console.error(
        "[ring] device list lookup failed; alerts go out without Ring device names for now:",
        err instanceof Error ? err.message : err,
      );
    }
    // On failure, keep serving the last list Ring returned, if any.
    return this.devices;
  }

  private remember(list: RingDevice[]): void {
    this.devices = new Map(list.map((device) => [device.id, device]));
    this.fetchedAt = this.now();
    this.failedAt = null;
  }
}

let directory: RingDeviceDirectory | null = null;

export function getRingDeviceDirectory(): RingDeviceDirectory {
  directory ??= new RingDeviceDirectory();
  return directory;
}

/**
 * Startup check: with an access token configured, lists the account's
 * devices once so a bad or expired token shows up in the log right away
 * rather than on the first event.
 */
export async function logRingConnection(target: RingDeviceDirectory = getRingDeviceDirectory()): Promise<void> {
  if (!getRingAccessToken()) {
    console.log("[ring] RING_ACCESS_TOKEN not set: alerts use webhook data only (fine for the event simulator)");
    return;
  }
  try {
    const devices = await target.refresh();
    const names = devices.map((device) => device.name).join(", ");
    console.log(`[ring] Ring API connected: ${devices.length} device(s)${names ? `: ${names}` : ""}`);
  } catch (err) {
    console.error("[ring] Ring API check failed:", err instanceof Error ? err.message : err);
  }
}
