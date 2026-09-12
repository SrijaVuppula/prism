// Real-time delivery to the companion app over WebSocket.
//
// A single WebSocketServer is attached to the existing HTTP server (see
// server.ts) rather than opening its own port, so the companion app can
// reach both the REST API and the live event stream on one origin.
// broadcastEvent() fans a scored event + its channel payloads out to every
// currently-connected client -- there's no per-user targeting yet because
// the companion app has no auth of its own (same placeholder state as the
// Ring account-linking flow in ring/routes.ts).

import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { PrismEvent } from "prism-alert-engine";
import type { ChannelPayloads } from "../bedrock/agentOrchestration";

export const COMPANION_WS_PATH = "/ws";

/** Message shape sent to companion-app clients over the WebSocket. */
export interface CompanionEventMessage {
  type: "prism-event";
  event: PrismEvent;
  channels: ChannelPayloads;
}

export class WebSocketDeliveryError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WebSocketDeliveryError";
  }
}

let wss: WebSocketServer | undefined;

/**
 * Attaches a WebSocketServer to an existing HTTP server. Idempotent: calling
 * this more than once (e.g. across hot reloads in dev) returns the
 * already-attached server rather than creating a second one.
 */
export function attachWebSocketServer(server: HttpServer): WebSocketServer {
  if (wss) {
    return wss;
  }

  const server_ = new WebSocketServer({ server, path: COMPANION_WS_PATH });

  server_.on("connection", (socket) => {
    console.log(`[websocket] client connected activeClients=${server_.clients.size}`);
    socket.on("close", () => {
      console.log(`[websocket] client disconnected activeClients=${server_.clients.size}`);
    });
    socket.on("error", (err) => {
      console.error("[websocket] client socket error:", err);
    });
  });

  wss = server_;
  return wss;
}

/** Number of currently-connected companion-app clients. */
export function getConnectedClientCount(): number {
  return wss?.clients.size ?? 0;
}

/**
 * Pushes a scored event and its channel payloads to every connected
 * companion-app client. Latency is measured from the moment this function is
 * called to the moment the send calls have all been issued to the socket
 * layer -- the same "log the round-trip of the step this module owns"
 * pattern used for the Bedrock call in bedrock/multimodalContext.ts.
 */
export function broadcastEvent(message: CompanionEventMessage): void {
  if (!wss) {
    throw new WebSocketDeliveryError(
      "WebSocket server has not been attached yet -- call attachWebSocketServer(server) first.",
    );
  }

  const startedAt = Date.now();
  const data = JSON.stringify(message);
  let delivered = 0;

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
      delivered += 1;
    }
  }

  console.log(
    `[websocket] broadcastEvent event=${message.event.id} recipients=${delivered} ` +
      `latencyMs=${Date.now() - startedAt}`,
  );
}

/** Closes the server and forgets it, so a new one can be attached. Test/shutdown use only. */
export function closeWebSocketServer(): void {
  wss?.close();
  wss = undefined;
}
