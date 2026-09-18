# Architecture

## Pipeline

```
Ring device/simulator
   │  webhook (ding / motion / person / package)
   ▼
prism-backend :: webhookHandler.ts
   │  HMAC verify → normalize → PrismEvent
   ▼
prism-backend :: bedrock/multimodalContext.ts
   │  snapshot + prompt → { category, description, confidence }
   ▼
prism-alert-engine :: scoring.ts
   │  Signal Score (0-100) + Signal Class (Routine/Notable/Urgent)
   ▼
prism-backend :: agentOrchestration.ts
   │  chains: normalize → classify → score → channel decision → dispatch
   ▼
prism-alert-engine :: channels/{haptic,visual,push}.ts
   │  pattern / card / push payload
   ▼
prism-backend :: api/websocket.ts  →  WebSocket broadcast
   │  (Urgent events also fan out to prism-backend :: push/dispatchPush.ts → Web Push)
   ▼
apps/prism-companion-web
   haptic vibration + visual context card + push notification
```

## Why this split

- `prism-alert-engine` has zero Ring-specific imports — it takes a normalized event and Bedrock output, and returns channel payloads. That's what makes it a genuine standalone package rather than just a folder inside a Ring-only app.
- `prism-backend` owns every Ring- and Bedrock-specific call, so there's one place to look to confirm the Ring API is actually called at runtime.
- `prism-companion-web` is the only piece you need to open in a browser to see and feel the result.

## Orchestration design

`bedrock/agentOrchestration.ts` is a plain, linear async chain (classify ->
score -> channel decision), not an AgentCore or Strands agent. That's a
deliberate choice, made after looking at both:

- There's no multi-step tool-calling or planning in this pipeline -- every
  event goes through the same four steps in the same order. An agent
  framework earns its complexity when a step needs the model to choose
  between actions; nothing here does that yet.
- Strands Agents (AWS's open-source agent SDK) is Python-first, with no
  mature JS/TypeScript SDK. Using it here would mean standing up a separate
  Python service the Node backend calls over the network -- a real
  architecture change, not a library swap.
- Bedrock AgentCore is a hosted runtime for deploying and operating agents,
  not an npm package. Adopting it means provisioning actual AWS
  infrastructure beyond what a single Bedrock InvokeModel call needs.

Revisit this if a later step needs the model to choose between actions --
e.g. deciding whether to run a repeat-visitor lookup before or after
classification -- rather than follow this fixed order. That's the point at
which an agent framework would earn its complexity here.

## Repeat-visitor memory

Bedrock embedding model → vector per event description → `pgvector` similarity search against the current session window → de-escalate Signal Class on a high-similarity match. Genuine vector search, not keyword/hash matching.

## Latency notes

Every stage is timed and logged on its own call:
- `bedrock/multimodalContext.ts` logs the Bedrock InvokeModel round-trip.
- `bedrock/agentOrchestration.ts` logs classification+scoring latency, then a
  second line for total latency (event received -> WebSocket broadcast sent
  and, when applicable, push dispatched).
- `api/websocket.ts` logs the WebSocket broadcast step itself -- this is the
  number the sub-second real-time delivery target is measured against, since
  it isolates the actual push-to-client step from the (much slower, and
  separately logged) Bedrock classification call ahead of it.
- `push/dispatchPush.ts` logs each Web Push dispatch: recipients, delivered,
  and pruned (subscriptions the push service reported as expired).

### Measured WebSocket delivery latency

`scripts/measure-delivery-latency.ts` (`npm run measure-delivery-latency`)
drives the real `attachWebSocketServer`/`broadcastEvent` code against real
`ws` client connections on a real HTTP server -- no mocks -- and times each
delivery from the `broadcastEvent()` call to the client's `message` event.
It deliberately does not call Bedrock: this isolates the delivery step the
sub-second target is about from classification latency, which is a
separate, already-logged number (see above) dominated by a network call to
Bedrock this step never makes.

Latest local run, 1,000 synthetic events x 5 connected clients (5,000
measured deliveries):

| mean | p50 | p95 | max |
| --- | --- | --- | --- |
| 0.068 ms | 0.061 ms | 0.100 ms | 1.334 ms |

Well under the sub-second target. This was run on localhost in a single
process, so it measures the delivery code path itself rather than
real-world network conditions between a deployed backend and a phone on
cellular/Wi-Fi -- re-run `npm run measure-delivery-latency` against a
deployed backend for a production-representative number.

`prism-backend/eval/runEvaluation.ts` reports mean/p50/p95/max latency and
classification accuracy across a labeled event set (see
`eval/fixtures/README.md` for how to populate it).
