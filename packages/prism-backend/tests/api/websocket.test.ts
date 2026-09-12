import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { PrismEvent } from "prism-alert-engine";
import {
  attachWebSocketServer,
  broadcastEvent,
  closeWebSocketServer,
  getConnectedClientCount,
  WebSocketDeliveryError,
  type CompanionEventMessage,
} from "../../src/api/websocket";

function scoredEvent(id: string): PrismEvent {
  return {
    id,
    occurredAt: "2026-01-01T12:00:00.000Z",
    snapshotUrl: "https://cdn.ring.com/snap/evt.jpg",
    classification: { category: "person", description: "A person at the door.", confidence: 0.9 },
    scoring: { signalScore: 80, signalClass: "Urgent", breakdown: {} },
  };
}

function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<CompanionEventMessage> {
  return new Promise((resolve) => {
    socket.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

let httpServer: Server;
let wsUrl: string;

beforeEach(async () => {
  httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  closeWebSocketServer();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("broadcastEvent", () => {
  it("throws WebSocketDeliveryError when no server has been attached", () => {
    expect(() => broadcastEvent({ type: "prism-event", event: scoredEvent("evt_1"), channels: {} })).toThrow(
      WebSocketDeliveryError,
    );
  });

  it("delivers the message to every connected client", async () => {
    attachWebSocketServer(httpServer);

    const clientA = await connectClient(wsUrl);
    const clientB = await connectClient(wsUrl);
    // Let the server register both connections before asserting the count.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getConnectedClientCount()).toBe(2);

    const messageA = nextMessage(clientA);
    const messageB = nextMessage(clientB);

    const event = scoredEvent("evt_broadcast");
    broadcastEvent({ type: "prism-event", event, channels: { haptic: [150, 100, 150] } });

    expect(await messageA).toEqual({ type: "prism-event", event, channels: { haptic: [150, 100, 150] } });
    expect(await messageB).toEqual({ type: "prism-event", event, channels: { haptic: [150, 100, 150] } });

    clientA.close();
    clientB.close();
  });

  it("attachWebSocketServer is idempotent", () => {
    const first = attachWebSocketServer(httpServer);
    const second = attachWebSocketServer(httpServer);
    expect(second).toBe(first);
  });
});
