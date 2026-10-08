# Prism

Context-aware, multi-channel accessible alerts for Ring.

## The problem

Ring and Nest doorbells alert through sound and app pings only, which is a well-documented failure mode for deaf, hard-of-hearing, and DeafBlind users. Today's fix is a separate proprietary hardware system (strobe/vibration pucks) that has no idea what the camera is actually seeing — it buzzes for any trigger, with no context.

## What it does

Prism connects Ring's real-time event stream to an AI context layer (Bedrock multimodal) and a custom, explainable Signal Score, then translates the result into distinct, purposeful haptic, visual, and push-notification patterns on a companion web app — fully in software, running on a device the user already owns. No custom hardware required.

## Structure

- `packages/prism-alert-engine` — Ring-agnostic core: a Bedrock classification wrapper, the Signal Score engine, and channel encoders (haptic/visual/push). Standalone and MIT-licensed; any doorbell or camera vendor could adopt it directly.
- `packages/prism-backend` — Ring account linking, webhook ingestion and Ring API calls, Bedrock classification + orchestration, Postgres + pgvector event store.
- `apps/prism-companion-web` — the React/PWA companion app that receives alerts in real time.
- `infra/` — the Bedrock IAM policy and AWS setup notes, and a docker-compose setup (Postgres, plus an optional containerized backend).
- `docs/` — architecture and accessibility notes.

## Setup

Requires Node 22+, Docker, and AWS credentials with Amazon Bedrock access to Claude Haiku 4.5 and Amazon Titan Text Embeddings V2 (`.env.example` defaults to `us-east-2`). The AWS SDK picks credentials up from your AWS CLI profile or environment; they never go in a file in this repo. `infra/aws/README.md` has the one-time model access steps and a least-privilege IAM policy.

```bash
./scripts/setup.sh   # npm install, create packages/prism-backend/.env, start Postgres and migrate
npm run dev          # backend on :3000, companion app on http://localhost:5173
npm run seed         # in a second terminal: replay five simulated doorbell events
```

Open http://localhost:5173 before running `npm run seed`, and set your household time zone under **Settings** (it starts as UTC): quiet hours, the late-night factor in the Signal Score, and alert times all use it. Each event arrives as a context card with its Signal Class. Notable and Urgent events also vibrate on Android Chrome, and once push is enabled in the app, Urgent events send a Web Push notification.

### Simulator mode (no Ring credentials)

The steps above need no Ring credentials. `npm run seed` sends webhooks in Ring's v1.1 format to `POST /webhooks/ring`, signed in `X-Signature` with the same `RING_WEBHOOK_SECRET` the backend uses, with labeled photos from `packages/prism-backend/eval/fixtures` as the snapshots. From the webhook on, Bedrock classification, the Signal Score, repeat-visitor memory and delivery follow the same path as a live Ring event. The run includes a repeat visit by the first visitor (scored lower by repeat-visitor memory) and ends with a night-time visit, sent with a late-night timestamp in your time zone so it scores as Urgent whatever time you run it. Run `npm run clear-history` between runs to start from a clean slate.

### Connecting to Ring

Prism calls the Ring Partner API at runtime: it downloads each event's snapshot (Ring's webhooks carry no image) and looks up the device's name (e.g. "Front Door"). There are two ways to give it access.

**Try the API with a Playground token** (no public URL needed):

1. In the Ring Developer Console, open the **Playground** and generate an access token (valid for about 30 minutes).
2. Add it to `packages/prism-backend/.env` as `RING_ACCESS_TOKEN=...`.
3. Run `npm run ring:devices` to list the devices the token can see.

Restart `npm run dev`, and the backend log shows `[ring] Ring API connected: ...`. To have simulated events come from one of those devices, run `SIMULATOR_DEVICE_ID=<device id> npm run seed`; the alerts then show the name the Ring API gives that device.

**Link a Ring account** for live doorbell events. Ring calls Prism's backend, so it has to be reachable over public HTTPS -- deployed, or through a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

1. In `packages/prism-backend/.env`, set `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_WEBHOOK_SECRET` (the app's HMAC signing key) and a `RING_LINK_PASSCODE` of your choice, then restart the backend.
2. In the Ring Developer Portal, under your app's **Account linking**, set the Account Link URL to `https://<your-host>/ring/link`, the Token Exchange URL to `https://<your-host>/ring/token-exchange` and the Webhook URL to `https://<your-host>/webhooks/ring`.
3. Enable the app from the Ring app. Ring sends Prism an authorization code, then opens Prism's link page, where you enter the passcode.

From then on, doorbell presses and motion events arrive as signed webhooks, and each alert is classified from the snapshot Prism downloads from Ring. See `docs/ARCHITECTURE.md` for how the linking, webhooks and snapshot downloads work.

### Other commands

- `npm test` — all workspaces' test suites
- `npm run build` — compile every workspace
- `npm run migrate` — apply any new database migrations
- `npm run clear-history` — delete stored alerts, repeat-visitor memory, feedback and visitor tags (keeps settings, push subscriptions and any linked Ring account)
- `npm run eval:repeat --workspace=prism-backend` — measure how well repeat-visitor matching separates the same visitor from different ones (live Bedrock), to tune its thresholds
- `npm run init-env` — fill in generated values missing from `packages/prism-backend/.env` (never overwrites existing ones)
- `npm run ring:devices` — list the Ring devices `RING_ACCESS_TOKEN` can see (live Ring API)

## Personalization and privacy

Prism learns a household's preferences without any account system: quiet hours, per-Signal-Class haptic pattern overrides, and thumbs up/down feedback on each alert's classification (which gradually adjusts the Signal Score's category weights -- see `docs/ARCHITECTURE.md`) are all editable from the companion app's Settings panel.

Known-visitor tagging is a separate, **strictly opt-in** feature, off by default. When a household turns it on, it can label a repeat visitor (e.g. "Mail carrier") so Prism de-escalates future alerts from that same visitor. Tags are matched using on-device/on-backend vector similarity, stored only in this household's own Postgres database, and are never uploaded, shared, or sent to any third party. Turning the feature off stops new tagging immediately; it does not delete tags already saved.

## Status

The Ring integration follows Ring's Partner API documentation: one-way account linking (token exchange, the signed-nonce Account Link page, token refresh), v1.1 webhook ingestion (X-Signature verification, deduplication), snapshot downloads and device lookups through the Ring API. It is covered by tests and exercised end to end with the event simulator, but has not yet been run against a live Ring account. The Signal Score engine is built and tested. Bedrock classification is wired end to end from the webhook receiver through the Signal Score engine to a channel decision. Real-time delivery is live: a WebSocket server broadcasts scored events to the companion web app, and Web Push notifications reach subscribed devices even when the app isn't in focus. Measured WebSocket delivery latency (`npm run measure-delivery-latency`) is sub-millisecond locally -- see `docs/ARCHITECTURE.md` for the methodology and numbers. The companion app itself renders the visual context card and triggers the haptic pattern for each alert.

Personalization and session memory are also built and tested: repeat-visitor memory (Bedrock embeddings + pgvector similarity search, scoped to a rolling per-device session window), per-household preferences (quiet hours, haptic overrides, the known-visitor-tagging opt-in), and a feedback loop that adjusts Signal Score category weights from accumulated thumbs up/down votes.

## Accessibility

The companion app targets WCAG 2.2 AA, per the Ring Partner API guideline. An automated `axe-core` pass runs against every component and page state as part of `npm run test` (zero violations), color contrast is verified against the WCAG formula directly from the app's palette, and every interactive element is confirmed keyboard-reachable with no trap via a full keyboard-only navigation walk. See [docs/ACCESSIBILITY.md](./docs/ACCESSIBILITY.md) for the full checklist, methodology, and the one item (a manual screen-reader pass) still open.

## License

MIT — see [LICENSE](./LICENSE).
