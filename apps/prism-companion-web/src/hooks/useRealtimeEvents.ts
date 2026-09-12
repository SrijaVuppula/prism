// Opens (and keeps open) a WebSocket connection to the backend's companion
// event stream (prism-backend/src/api/websocket.ts), and keeps a short
// history of received events in state.

import { useEffect, useRef, useState } from "react";
import type { CompanionEventMessage } from "../types";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface RealtimeEventsState {
  status: ConnectionStatus;
  /** Most recent events first. */
  events: CompanionEventMessage[];
  latestEvent: CompanionEventMessage | null;
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

export function useRealtimeEvents(): RealtimeEventsState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<CompanionEventMessage[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

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
        setEvents((previous) => [message, ...previous].slice(0, MAX_HISTORY));
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

  return { status, events, latestEvent: events[0] ?? null };
}
