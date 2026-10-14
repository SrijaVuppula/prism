// Picks up Ring events Prism missed: while the backend was down, or when a
// webhook never arrived (Ring retries a failed delivery, but not forever).
// At startup and then every RING_HISTORY_POLL_MINUTES (default 10), Prism
// reads each device's event history (GET /v1/history/devices/{id}/events)
// and runs any doorbell press or motion event it hasn't stored through the
// same pipeline as a webhook.
//
// An event found within a few minutes still alerts as usual. An older one is
// stored quietly -- no vibration or push for something that happened an
// hour ago -- so it appears in the app's history and in "What did I miss?".
// The history and the webhooks give the same event different ids, so events
// are matched by device and time, and the history is only read for events
// at least a minute old, by which time their webhook has normally arrived.

import { runPipeline } from "../bedrock/agentOrchestration";
import { getRingEventStore, type RingEventStore } from "../db/eventStore";
import { getRingApiToken } from "./accessTokens";
import { getRingHistoryPollMinutes } from "./config";
import { RingClient, type RingHistoryEvent } from "./ringClient";
import { ringSnapshotUrl } from "./snapshots";
import { fallbackClassification, motionKind, type RingAlert, type RingAlertKind } from "./webhookHandler";

const EVENT_TYPES = ["ding", "motion"];
/** Events newer than this are left to their webhook. */
const WEBHOOK_GRACE_MS = 60_000;
/** Events found within this long of happening still alert; older ones are stored quietly. */
const LIVE_WINDOW_MS = 5 * 60_000;
/** A stored event from the same device this close in time is the same event. */
const DUPLICATE_WINDOW_MS = 15_000;
/** How far back the first read after startup looks. */
const FIRST_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_PAGES_PER_DEVICE = 5;
const FIRST_RUN_DELAY_MS = 15_000;

/** The alert a history event calls for, or null for one Prism doesn't alert on (live view sessions). */
export function historyEventToAlert(event: RingHistoryEvent): RingAlert | null {
  const [type, subType] = event.eventType.split(".", 2);
  let kind: RingAlertKind;
  if (type === "ding") kind = "ding";
  else if (type === "motion") kind = motionKind(subType);
  else return null;

  const fallback = fallbackClassification(kind, subType);
  return {
    kind,
    event: {
      id: event.id,
      occurredAt: new Date(event.start).toISOString(),
      snapshotUrl: ringSnapshotUrl({ deviceId: event.deviceId, timestamp: event.start }),
      deviceId: event.deviceId,
    },
    ...(fallback ? { fallbackClassification: fallback } : {}),
  };
}

/** The history entry as stored in ring_events.raw_payload, in Ring's own shape. */
function rawPayload(event: RingHistoryEvent) {
  return {
    type: "history-events",
    id: event.id,
    attributes: { event_type: event.eventType, start: event.start },
    relationships: { source: { data: { type: "devices", id: event.deviceId } } },
  };
}

export interface RingHistoryCatchUpDeps {
  getToken: () => Promise<string | null>;
  createClient: (token: string) => Pick<RingClient, "listDevices" | "listEventHistory">;
  eventStore: () => Pick<RingEventStore, "save" | "hasEventNear">;
  runPipeline: typeof runPipeline;
  now: () => number;
}

const defaultDeps: RingHistoryCatchUpDeps = {
  getToken: () => getRingApiToken(),
  createClient: (token) => new RingClient(token),
  eventStore: () => getRingEventStore(),
  runPipeline,
  now: () => Date.now(),
};

export interface CatchUpResult {
  /** Events in the history Prism hadn't stored. */
  missed: number;
  alerted: number;
  storedQuietly: number;
}

export class RingHistoryCatchUp {
  /** Events up to this time (epoch ms) have been checked. */
  private checkedUntil: number | null = null;
  private running: Promise<CatchUpResult> | null = null;

  constructor(private readonly deps: RingHistoryCatchUpDeps = defaultDeps) {}

  /** Reads the history once. Concurrent calls share one read. */
  run(): Promise<CatchUpResult> {
    this.running ??= this.read().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async read(): Promise<CatchUpResult> {
    const result: CatchUpResult = { missed: 0, alerted: 0, storedQuietly: 0 };
    const token = await this.deps.getToken();
    if (!token) return result;

    const client = this.deps.createClient(token);
    const now = this.deps.now();
    const until = now - WEBHOOK_GRACE_MS;
    const since = this.checkedUntil !== null ? this.checkedUntil - WEBHOOK_GRACE_MS : now - FIRST_LOOKBACK_MS;
    const store = this.deps.eventStore();

    for (const device of await client.listDevices()) {
      const events = await this.eventsBetween(client, device.id, since, until);
      // Oldest first, so the pipeline sees visits in the order they happened.
      for (const historyEvent of events.reverse()) {
        const alert = historyEventToAlert(historyEvent);
        if (!alert) continue;
        const { event } = alert;
        if (await store.hasEventNear(historyEvent.deviceId, event.occurredAt, DUPLICATE_WINDOW_MS)) continue;
        if (!(await store.save(event, alert.kind, rawPayload(historyEvent)))) continue;

        result.missed += 1;
        const quiet = now - historyEvent.start > LIVE_WINDOW_MS;
        try {
          await this.deps.runPipeline(event, undefined, {
            quiet,
            ...(alert.fallbackClassification ? { fallbackClassification: alert.fallbackClassification } : {}),
          });
          if (quiet) result.storedQuietly += 1;
          else result.alerted += 1;
        } catch (err) {
          console.error(`[ring] couldn't process missed event ${event.id} from the event history:`, err);
        }
      }
    }

    this.checkedUntil = until;
    if (result.missed > 0) {
      console.log(
        `[ring] event history: ${result.missed} event(s) Prism hadn't received; ` +
          `alerted for ${result.alerted}, stored ${result.storedQuietly} quietly as history`,
      );
    }
    return result;
  }

  private async eventsBetween(
    client: Pick<RingClient, "listEventHistory">,
    deviceId: string,
    since: number,
    until: number,
  ): Promise<RingHistoryEvent[]> {
    const found: RingHistoryEvent[] = [];
    let next: string | undefined;
    for (let page = 0; page < MAX_PAGES_PER_DEVICE; page += 1) {
      const result = await client.listEventHistory(deviceId, EVENT_TYPES, next);
      found.push(...result.events.filter((event) => event.start >= since && event.start <= until));
      const oldest = result.events[result.events.length - 1];
      if (!result.next || !oldest || oldest.start < since) break;
      next = result.next;
    }
    return found;
  }
}

/** Reads the event history shortly after startup and then on a schedule. Failures are logged, never thrown. */
export function startRingHistoryCatchUp(catchUp: RingHistoryCatchUp = new RingHistoryCatchUp()): (() => void) | null {
  const minutes = getRingHistoryPollMinutes();
  if (minutes === 0) return null;

  const tick = () =>
    void catchUp.run().catch((err) => {
      console.error("[ring] couldn't read the event history:", err instanceof Error ? err.message : err);
    });
  const first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  const interval = setInterval(tick, minutes * 60_000);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
