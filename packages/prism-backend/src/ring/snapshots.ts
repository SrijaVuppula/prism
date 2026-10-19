// Snapshots for real Ring events. Ring's webhooks carry no image, so a Ring
// event's snapshotUrl is a ring:// reference - device, moment, and the Ring
// account it belongs to - which loadSnapshotBytes() (bedrock/
// multimodalContext.ts) resolves by downloading that frame with the Ring
// API's image download endpoint.
//
// Before a downloaded frame is used, the device's privacy zones are blacked
// out (privacyZones.ts), so no part of Prism - classification, embeddings,
// or the companion app - sees an area the owner marked private. If the
// zones can't be read, the frame isn't used at all and the alert falls back
// to Ring's event type.
//
// A snapshot is read up to three times per event (classification, the
// optional image embedding, and the companion app showing it), so recent
// downloads are kept in a small in-memory cache.

import { getRingApiToken } from "./accessTokens";
import { maskPrivacyZones, zonesForComponent, type DevicePrivacyZones, type PrivacyZone } from "./privacyZones";
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
 * Right after an event, the recording the frame comes from may not be
 * stored yet, and Ring answers 416 MEDIA_NOT_FOUND or 425
 * RECORDING_NOT_READY. Ring's docs say to retry those on this schedule
 * (then every 30 seconds), with up to 10% jitter on each wait.
 */
const RETRYABLE_STATUSES = new Set([416, 425]);
const RETRY_SCHEDULE_MS = [5_000, 10_000, 20_000, 30_000];
const RETRY_JITTER = 0.1;
/**
 * Ring suggests retrying for up to 2 minutes, but the alert waits on the
 * download, so Prism stops retrying after about 20 seconds and the alert
 * goes out using Ring's event type instead (see agentOrchestration.ts).
 * Failures aren't cached, so a later read, such as the companion app
 * loading the picture, downloads again.
 */
const RETRY_BUDGET_MS = 20_000;
/** After this long, Ring treats missing media for an event as unavailable for good. */
const MEDIA_READY_WINDOW_MS = 120_000;
const CACHE_SIZE = 32;
/** Owners can change privacy zones at any time, so they're re-read this often. */
const ZONES_TTL_MS = 5 * 60_000;

export interface RingSnapshotLoaderDeps {
  getToken: (accountId?: string) => Promise<string | null>;
  createClient: (token: string) => Pick<RingClient, "downloadImage" | "getPrivacyZones">;
  mask: (image: RingImage, zones: PrivacyZone[]) => Promise<RingImage>;
  sleep: (ms: number) => Promise<void>;
  /** Epoch milliseconds, comparable with a Ring event's timestamp. */
  now: () => number;
  /** A number in [0, 1), for the retry jitter. */
  random: () => number;
}

const defaultDeps: RingSnapshotLoaderDeps = {
  getToken: (accountId) => getRingApiToken(accountId),
  createClient: (token) => new RingClient(token),
  mask: maskPrivacyZones,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  random: () => Math.random(),
};

export class RingSnapshotLoader {
  private readonly cache = new Map<string, Promise<RingImage>>();
  private readonly zones = new Map<string, { readAt: number; pending: Promise<DevicePrivacyZones> }>();

  constructor(private readonly deps: RingSnapshotLoaderDeps = defaultDeps) {}

  /** Forgets every downloaded snapshot and privacy-zone setting, e.g. when the household deletes its history. */
  clear(): void {
    this.cache.clear();
    this.zones.clear();
  }

  load(snapshotUrl: string): Promise<RingImage> {
    const cached = this.cache.get(snapshotUrl);
    if (cached) return cached;

    const pending = this.download(snapshotUrl);
    this.cache.set(snapshotUrl, pending);
    // Failures aren't cached, so the next reader tries again.
    pending.catch(() => {
      if (this.cache.get(snapshotUrl) === pending) this.cache.delete(snapshotUrl);
    });
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
    // Read the zones while the frame downloads.
    const zones = this.privacyZones(client, ref.deviceId);
    zones.catch(() => {});
    const image = await this.downloadWithRetries(client, ref);

    const applicable = zonesForComponent(await zones, ref.componentId);
    if (applicable.length === 0) return image;
    const masked = await this.deps.mask(image, applicable);
    console.log(`[ring] blacked out ${applicable.length} privacy zone(s) in the snapshot from ${ref.deviceId}`);
    return masked;
  }

  private privacyZones(client: Pick<RingClient, "getPrivacyZones">, deviceId: string): Promise<DevicePrivacyZones> {
    const cached = this.zones.get(deviceId);
    if (cached && this.deps.now() - cached.readAt < ZONES_TTL_MS) return cached.pending;

    const pending = client.getPrivacyZones(deviceId);
    this.zones.set(deviceId, { readAt: this.deps.now(), pending });
    pending.catch(() => {
      if (this.zones.get(deviceId)?.pending === pending) this.zones.delete(deviceId);
    });
    return pending;
  }

  private async downloadWithRetries(client: Pick<RingClient, "downloadImage">, ref: RingSnapshotRef): Promise<RingImage> {
    const deadline = Math.min(this.deps.now() + RETRY_BUDGET_MS, ref.timestamp + MEDIA_READY_WINDOW_MS);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await client.downloadImage(ref.deviceId, ref.timestamp, ref.componentId);
      } catch (err) {
        const retryable = err instanceof RingApiError && err.status !== undefined && RETRYABLE_STATUSES.has(err.status);
        if (!retryable) throw err;
        const scheduled = RETRY_SCHEDULE_MS[Math.min(attempt, RETRY_SCHEDULE_MS.length - 1)];
        const delay = scheduled + this.deps.random() * scheduled * RETRY_JITTER;
        if (this.deps.now() + delay > deadline) throw err;
        await this.deps.sleep(delay);
      }
    }
  }
}

let loader: RingSnapshotLoader | null = null;

export function getRingSnapshotLoader(): RingSnapshotLoader {
  loader ??= new RingSnapshotLoader();
  return loader;
}
