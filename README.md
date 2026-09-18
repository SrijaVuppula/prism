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

## Personalization and privacy

Prism learns a household's preferences without any account system: quiet hours, per-Signal-Class haptic pattern overrides, and thumbs up/down feedback on each alert's classification (which gradually adjusts the Signal Score's category weights -- see `docs/ARCHITECTURE.md`) are all editable from the companion app's Settings panel.

Known-visitor tagging is a separate, **strictly opt-in** feature, off by default. When a household turns it on, it can label a repeat visitor (e.g. "Mail carrier") so Prism de-escalates future alerts from that same visitor. Tags are matched using on-device/on-backend vector similarity, stored only in this household's own Postgres database, and are never uploaded, shared, or sent to any third party. Turning the feature off stops new tagging immediately; it does not delete tags already saved.

## Status

Ring OAuth account linking, HMAC-verified webhook ingestion (normalized into a shared event schema and persisted), and the Signal Score engine are built and tested. Bedrock classification is wired end to end from the webhook receiver through the Signal Score engine to a channel decision. Real-time delivery is live: a WebSocket server broadcasts scored events to the companion web app, and Web Push notifications reach subscribed devices even when the app isn't in focus. Measured WebSocket delivery latency (`npm run measure-delivery-latency`) is sub-millisecond locally -- see `docs/ARCHITECTURE.md` for the methodology and numbers. The companion app itself renders the visual context card and triggers the haptic pattern for each alert.

Personalization and session memory are also built and tested: repeat-visitor memory (Bedrock embeddings + pgvector similarity search, scoped to a rolling per-device session window), per-household preferences (quiet hours, haptic overrides, the known-visitor-tagging opt-in), and a feedback loop that adjusts Signal Score category weights from accumulated thumbs up/down votes.

## Accessibility

The companion app targets WCAG 2.2 AA, per the Ring Partner API guideline. An automated `axe-core` pass runs against every component and page state as part of `npm run test` (zero violations), color contrast is verified against the WCAG formula directly from the app's palette, and every interactive element is confirmed keyboard-reachable with no trap via a full keyboard-only navigation walk. See [docs/ACCESSIBILITY.md](./docs/ACCESSIBILITY.md) for the full checklist, methodology, and the one item (a manual screen-reader pass) still open.

## License

MIT — see [LICENSE](./LICENSE).
