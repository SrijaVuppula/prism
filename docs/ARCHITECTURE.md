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
prism-backend :: api/websocket.ts  →  WebSocket/SSE
   ▼
apps/prism-companion-web
   haptic vibration + visual context card + push notification
```

## Why this split

- `prism-alert-engine` has zero Ring-specific imports — it takes a normalized event and Bedrock output, and returns channel payloads. That's what makes it a genuine standalone package rather than just a folder inside a Ring-only app.
- `prism-backend` owns every Ring- and Bedrock-specific call, so there's one place to look to confirm the Ring API is actually called at runtime.
- `prism-companion-web` is the only piece you need to open in a browser to see and feel the result.

## Repeat-visitor memory

Bedrock embedding model → vector per event description → `pgvector` similarity search against the current session window → de-escalate Signal Class on a high-similarity match. Genuine vector search, not keyword/hash matching.

## Latency notes

Both stages are timed and logged on every call:
- `bedrock/multimodalContext.ts` logs the Bedrock InvokeModel round-trip.
- `bedrock/agentOrchestration.ts` logs the full event -> classification ->
  score -> channel-decision latency.

`prism-backend/eval/runEvaluation.ts` reports mean/p50/p95/max latency and
classification accuracy across a labeled event set (see
`eval/fixtures/README.md` for how to populate it).
