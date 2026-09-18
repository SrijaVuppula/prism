# Prism

Context-aware, multi-channel accessible alerts for Ring.

## The problem

Ring and Nest doorbells alert through sound and app pings only, which is a well-documented failure mode for deaf, hard-of-hearing, and DeafBlind users. Today's fix is a separate proprietary hardware system (strobe/vibration pucks) that has no idea what the camera is actually seeing — it buzzes for any trigger, with no context.

## What it does

Prism connects Ring's real-time event stream to an AI context layer (Bedrock multimodal) and a custom, explainable Signal Score, then translates the result into distinct, purposeful haptic, visual, and push-notification patterns on a companion web app — fully in software, running on a device the user already owns. No custom hardware required.

## Structure

- `packages/prism-alert-engine` — Ring-agnostic core: a Bedrock classification wrapper, the Signal Score engine, and channel encoders (haptic/visual/push). Standalone and MIT-licensed; any doorbell or camera vendor could adopt it directly.
- `packages/prism-backend` — Ring OAuth + webhook ingestion, Bedrock classification + orchestration, Postgres + pgvector event store.
- `apps/prism-companion-web` — the React/PWA companion app that receives alerts in real time.
- `infra/` — AWS config and a local docker-compose setup (Postgres + backend + web).
- `docs/` — architecture and accessibility notes.

## Setup

```bash
npm install
docker compose -f infra/docker-compose.yml up -d
npm run dev:backend && npm run dev:web
```

## Status

Ring OAuth account linking, HMAC-verified webhook ingestion (normalized into a shared event schema and persisted), and the Signal Score engine are built and tested. Bedrock classification is wired end to end from the webhook receiver through the Signal Score engine to a channel decision. Real-time delivery is live: a WebSocket server broadcasts scored events to the companion web app, and Web Push notifications reach subscribed devices even when the app isn't in focus. Measured WebSocket delivery latency (`npm run measure-delivery-latency`) is sub-millisecond locally -- see `docs/ARCHITECTURE.md` for the methodology and numbers. The companion app itself renders the visual context card and triggers the haptic pattern for each alert. Repeat-visitor memory is still in progress.

## License

MIT — see [LICENSE](./LICENSE).
