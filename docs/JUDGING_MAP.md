# Judging Map

Living document — fill in as each deliverable is built, then lift directly into the Devpost written description.

| Criterion | Deliverable | Where in repo | Status |
| --- | --- | --- | --- |
| Tech Implementation | Ring OAuth + webhook integration | `packages/prism-backend/src/ring/` | ☐ |
| Tech Implementation | Bedrock multimodal call + explainable scoring engine | `packages/prism-alert-engine/src/{classifier,scoring}.ts` | ☐ |
| Tech Implementation | AgentCore/Strands orchestration | `packages/prism-backend/src/bedrock/agentOrchestration.ts` | ☐ |
| Tech Implementation | Measured latency + accuracy benchmarks | `docs/ARCHITECTURE.md`, Phase 2.4/6.3 | ☐ |
| Design | WCAG 2.2 AA audited companion app | `docs/ACCESSIBILITY.md`, `apps/prism-companion-web` | ☐ |
| Design | Purposeful, documented haptic/visual patterns | `docs/ACCESSIBILITY.md`, `channels/haptic.ts` | ☐ |
| Design | Sub-second measured delivery | `api/websocket.ts`, Phase 3.5 | ☐ |
| Potential Impact | Serves documented underserved population | Written description, demo video | ☐ |
| Potential Impact | Open-sourced, reusable core engine | `packages/prism-alert-engine` (standalone repo) | ☐ |
| Quality of Idea | Context-aware, not generic motion alert | Signal Score engine | ☐ |
| Quality of Idea | State/personalization persists across sessions | Phase 4 — pgvector repeat-visitor memory | ☐ |
| Quality of Idea | Working feedback loop | Phase 4.3 — thumbs up/down | ☐ |
