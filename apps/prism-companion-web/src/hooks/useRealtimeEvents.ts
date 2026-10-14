// Opens (and keeps open) a WebSocket connection to the backend's companion
// event stream (prism-backend/src/api/websocket.ts), and keeps a short
// history of events in state: the most recent stored alerts, loaded once
// from GET /alerts so a reload doesn't empty the screen, plus each event
// that arrives live.

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveApiBase } from "../lib/apiBase";
import type { CompanionEventMessage } from "../types";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface RealtimeEventsState {
  status: ConnectionStatus;
  /** Most recent events first. */
  events: CompanionEventMessage[];
  latestEvent: CompanionEventMessage | null;
  /**
   * The latest event that arrived over the WebSocket while the app was
   * open, as opposed to one loaded from history. Only these should vibrate.
   */
  latestLiveEvent: CompanionEventMessage | null;
  /** Forgets the received events, e.g. after the household deletes its alert history. */
  clear: () => void;
}

const RECONNECT_DELAY_MS = 2000;
const MAX_HISTORY = 20;

/**
 * Resolves the companion event WebSocket URL. VITE_WS_URL lets a deployment
 * point at a different origin; the default derives ws(s)://<current
 * origin>/ws so local dev works through Vite's proxy (vite.config.ts)
 * without any env file at all.
 */
function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/** Live and loaded events together: one entry per event, most recent first. */
function merge(current: CompanionEventMessage[], loaded: CompanionEventMessage[]): CompanionEventMessage[] {
  const byId = new Map<string, CompanionEventMessage>();
  for (const message of [...current, ...loaded]) {
    if (!byId.has(message.event.id)) byId.set(message.event.id, message);
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.event.occurredAt) - Date.parse(a.event.occurredAt))
    .slice(0, MAX_HISTORY);
}

export function useRealtimeEvents(): RealtimeEventsState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<CompanionEventMessage[]>([]);
  const [latestLiveEvent, setLatestLiveEvent] = useState<CompanionEventMessage | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${resolveApiBase()}/alerts?limit=${MAX_HISTORY}`);
        if (!response.ok) throw new Error(`Failed to load recent alerts (${response.status})`);
        const { alerts } = (await response.json()) as { alerts?: CompanionEventMessage[] };
        if (!cancelled && Array.isArray(alerts)) setEvents((previous) => merge(previous, alerts));
      } catch (err) {
        // Live alerts still arrive; only the earlier ones are missing.
        console.error("[realtime] failed to load recent alerts:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let cancelled = false;

    function connect() {
      setStatus("connecting");
      socket = new WebSocket(resolveWsUrl());

      socket.onopen = () => {
        if (!cancelled) setStatus("open");
      };

      socket.onmessage = (messageEvent) => {
        let message: CompanionEventMessage;
        try {
          message = JSON.parse(messageEvent.data as string) as CompanionEventMessage;
        } catch (err) {
          console.error("[realtime] failed to parse event message:", err);
          return;
        }
        if (message.type !== "prism-event") return;
        setEvents((previous) => [message, ...previous.filter((m) => m.event.id !== message.event.id)].slice(0, MAX_HISTORY));
        setLatestLiveEvent(message);
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      // The close handler above is where reconnection is scheduled; onerror
      // just makes sure a socket that errored actually closes instead of
      // sitting half-open.
      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
    setLatestLiveEvent(null);
  }, []);

  return { status, events, latestEvent: events[0] ?? null, latestLiveEvent, clear };
}
