// Measures real end-to-end WebSocket delivery latency for the real-time
// delivery layer (prism-backend/src/api/websocket.ts): from the moment the
// backend calls broadcastEvent() to the moment a connected companion-app
// client actually receives the message, over a real WebSocket connection
// on a real HTTP server -- no mocks, no stubbed sockets.
//
// This is deliberately isolated from Bedrock classification latency
// (already logged separately in bedrock/multimodalContext.ts and
// bedrock/agentOrchestration.ts): the sub-second real-time delivery target
// in docs/ARCHITECTURE.md is about this step specifically -- the one
// api/websocket.ts owns -- not the full classify-then-deliver round trip,
// which is dominated by a network call to Bedrock this script never makes.
//
// Usage: npm run measure-delivery-latency [-- --events=200 --clients=3]

import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { WebSocket } from "ws";
import {
  buildContextCard,
  buildPushPayload,
  computeSignalScore,
  encodeHapticPattern,
  type PrismEvent,
} from "prism-alert-engine";
import {
  attachWebSocketServer,
  broadcastEvent,
  closeWebSocketServer,
  type CompanionEventMessage,
} from "../packages/prism-backend/src/api/websocket";

function parseIntArg(flag: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? Number(arg.split("=")[1]) : fallback;
}

const EVENT_COUNT = parseIntArg("events", 200);
const CLIENT_COUNT = parseIntArg("clients", 3);

function syntheticEvent(index: number): PrismEvent {
  const occurredAt = new Date().toISOString();
  const classification = {
    category: "person" as const,
    description: `Synthetic delivery-latency test event #${index}.`,
    confidence: 0.9,
  };
  const scoring = computeSignalScore({
    category: classification.category,
    confidence: classification.confidence,
    hourOfDay: new Date(occurredAt).getUTCHours(),
    isKnownVisitor: false,
    repeatVisitCount: 0,
    isQuietHours: false,
  });
  return {
    id: `latency-test-${index}`,
    occurredAt,
    snapshotUrl: "https://example.com/latency-test.jpg",
    classification,
    scoring,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function connectClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function main() {
  const httpServer = createServer();
  attachWebSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `ws://127.0.0.1:${port}/ws`;

  const clients = await Promise.all(Array.from({ length: CLIENT_COUNT }, () => connectClient(url)));

  const latenciesMs: number[] = [];

  for (let i = 0; i < EVENT_COUNT; i++) {
    const event = syntheticEvent(i);
    const scoring = event.scoring;
    if (!scoring) throw new Error("synthetic event is missing scoring");

    const channels: CompanionEventMessage["channels"] = {
      visual: buildContextCard(event),
      haptic: encodeHapticPattern(scoring.signalClass),
      push: buildPushPayload(event),
    };
    const message: CompanionEventMessage = { type: "prism-event", event, channels };

    const receipts = clients.map(
      (client) =>
        new Promise<number>((resolve) => {
          client.once("message", () => resolve(performance.now()));
        }),
    );

    const sentAt = performance.now();
    broadcastEvent(message);
    const receivedAts = await Promise.all(receipts);

    for (const receivedAt of receivedAts) {
      latenciesMs.push(receivedAt - sentAt);
    }
  }

  for (const client of clients) client.close();
  closeWebSocketServer();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const mean = latenciesMs.reduce((sum, v) => sum + v, 0) / latenciesMs.length;
  const max = sorted[sorted.length - 1];

  console.log(
    `\n[delivery-latency] ${EVENT_COUNT} events x ${CLIENT_COUNT} clients = ${latenciesMs.length} measured deliveries (server broadcastEvent() call -> client message received)`,
  );
  console.log(
    `[delivery-latency] mean=${mean.toFixed(3)}ms p50=${percentile(sorted, 50).toFixed(3)}ms ` +
      `p95=${percentile(sorted, 95).toFixed(3)}ms max=${max.toFixed(3)}ms`,
  );
}

main().catch((err) => {
  console.error("[delivery-latency] measurement run failed:", err);
  process.exitCode = 1;
});
