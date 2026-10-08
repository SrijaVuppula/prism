// Snapshots for real Ring events. Ring's webhooks carry no image, so a Ring
// event's snapshotUrl is a ring:// reference -- device, moment, and the Ring
// account it belongs to -- which loadSnapshotBytes() (bedrock/
// multimodalContext.ts) resolves by downloading that frame with the Ring
// API's image download endpoint.
//
// A snapshot is read up to three times per event (classification, the
// optional image embedding, and the companion app showing it), so recent
// downloads are kept in a small in-memory cache.

import { getRingApiToken } from "./accessTokens";
import { RingApiError, RingClient, type RingImage } from "./ringClient";

const SCHEME = "ring:";

export interface RingSnapshotRef {
  deviceId: string;
  /** Epoch milliseconds. */
  timestamp: number;
  /** The Ring account the device belongs to (webhook meta.account_id). */
  accountId?: string;
  /** Camera module on a multi-camera device. */
  componentId?: string;
}

export function ringSnapshotUrl(ref: RingSnapshotRef): string {
  const url = new URL(`ring://devices/${encodeURIComponent(ref.deviceId)}/snapshot`);
  url.searchParams.set("at", String(ref.timestamp));
  if (ref.accountId) url.searchParams.set("account", ref.accountId);
  if (ref.componentId !== undefined) url.searchParams.set("component", ref.componentId);
  return url.toString();
}

export function isRingSnapshotUrl(value: string): boolean {
  return value.startsWith(`${SCHEME}//`);
}

/** The parts of a ring:// snapshot reference, or null when it isn't one. */
export function parseRingSnapshotUrl(value: string): RingSnapshotRef | null {
  if (!isRingSnapshotUrl(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const match = /^\/([^/]+)\/snapshot$/.exec(url.pathname);
  const timestamp = Number(url.searchParams.get("at"));
  if (url.host !== "devices" || !match || !Number.isInteger(timestamp) || timestamp <= 0) return null;
  return {
    deviceId: decodeURIComponent(match[1]),
    timestamp,
    ...(url.searchParams.get("account") ? { accountId: url.searchParams.get("account")! } : {}),
    ...(url.searchParams.has("component") ? { componentId: url.searchParams.get("component")! } : {}),
  };
}

/**
 * Waits before retrying when Ring answers 425 RECORDING_NOT_READY: right
 * after an event the recording the frame comes from may not be stored yet.
 */
const NOT_READY_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const CACHE_SIZE = 32;

export interface RingSnapshotLoaderDeps {
  getToken: (accountId?: string) => Promise<string | null>;
  createClient: (token: string) => Pick<RingClient, "downloadImage">;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: RingSnapshotLoaderDeps = {
  getToken: (accountId) => getRingApiToken(accountId),
  createClient: (token) => new RingClient(token),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class RingSnapshotLoader {
  private readonly cache = new Map<string, Promise<RingImage>>();

  constructor(private readonly deps: RingSnapshotLoaderDeps = defaultDeps) {}

  load(snapshotUrl: string): Promise<RingImage> {
    const cached = this.cache.get(snapshotUrl);
    if (cached) return cached;

    const pending = this.download(snapshotUrl);
    this.cache.set(snapshotUrl, pending);
    // Failures aren't cached, so the next reader tries again.
    pending.catch(() => this.cache.delete(snapshotUrl));
    while (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return pending;
  }

  private async download(snapshotUrl: string): Promise<RingImage> {
    const ref = parseRingSnapshotUrl(snapshotUrl);
    if (!ref) {
      throw new RingApiError(`Not a Ring snapshot reference: ${snapshotUrl}`);
    }
    const token = await this.deps.getToken(ref.accountId);
    if (!token) {
      throw new RingApiError("No Ring access token to download the snapshot with (link a Ring account or set RING_ACCESS_TOKEN)");
    }
    const client = this.deps.createClient(token);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await client.downloadImage(ref.deviceId, ref.timestamp, ref.componentId);
      } catch (err) {
        const notReady = err instanceof RingApiError && err.status === 425;
        if (!notReady || attempt >= NOT_READY_RETRY_DELAYS_MS.length) throw err;
        await this.deps.sleep(NOT_READY_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
}

let loader: RingSnapshotLoader | null = null;

export function getRingSnapshotLoader(): RingSnapshotLoader {
  loader ??= new RingSnapshotLoader();
  return loader;
}
