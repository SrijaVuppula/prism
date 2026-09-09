# Prism

**Context-aware, multi-channel accessible alerts for Ring.**
Built for the *Build, Ship, Shape: Amazon Developer Hackathon* — Primary Track: Ring · Mini-Challenges: AWS Builder, Open Source.

## What it does

Ring/Nest doorbells alert with sound and app pings only — a documented failure mode for deaf, hard-of-hearing, and DeafBlind users. Prism connects Ring's event stream to a Bedrock multimodal context layer and a custom, explainable **Signal Score** engine, then drives distinct haptic, visual, and push alert patterns on a companion web app — no proprietary hardware required.

## Structure

- `packages/prism-alert-engine` — Ring-agnostic core: Bedrock classification wrapper, the Signal Score engine, and channel encoders (haptic/visual/push). Standalone, MIT-licensed (Open Source mini-challenge).
- `packages/prism-backend` — Ring OAuth + webhook ingestion, Bedrock/AgentCore orchestration, Postgres + pgvector event store.
- `apps/prism-companion-web` — React/PWA companion app judges open in a browser to see and feel the result.
- `infra/` — AWS config, local docker-compose (Postgres + backend + web).
- `docs/` — architecture, accessibility, judging map, friction log, demo script.

## Setup (target: 3 commands or fewer)

```bash
npm install
docker compose -f infra/docker-compose.yml up -d
npm run dev:backend && npm run dev:web
```

## Status

🚧 Phase 0 — repo scaffolded. See `docs/JUDGING_MAP.md` and the project plan for the full 8-phase build sequence.

## License

MIT — see [LICENSE](./LICENSE).
