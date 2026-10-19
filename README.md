# Prism

Doorbell alerts you can see and feel. Context-aware, multi-channel accessible alerts for Ring.

**Try it live: [d2w68k35faj3ab.cloudfront.net](https://d2w68k35faj3ab.cloudfront.net)**. No sign-up; it works on a phone or a laptop.

1. Press **Send a test visitor**. Within a few seconds the alert arrives with its Signal Class, its score and the reasons behind it. Each press sends the next of five visitors: a doorbell press, a cat, a package, the same visitor again, then a night-time visit. On Android Chrome, Notable and Urgent alerts also vibrate.
2. Under **Catch up**, press **What did I miss?**, or ask something like "Did anyone come while I was asleep?".

The demo runs on AWS with simulated Ring events, and everyone trying it shares one household. To run Prism yourself, see [Setup](#setup) or [`infra/aws/demo`](infra/aws/demo/README.md).

![The Prism companion app. The latest alert is an Urgent one: a person at the door at 11:36 PM, with its Signal Score of 79 broken down beside it (person detected, model confidence, late night) and its vibration pattern of three long pulses. The Catch up panel answers "What did I miss?": "You have 5 new alerts: 1 Urgent, 3 Notable and 1 Routine", followed by a sentence on each. Earlier alerts for a delivery worker who came twice, a package and a cat are listed below.](docs/images/companion-app.jpg)

## The problem

About 430 million people worldwide have disabling hearing loss ([WHO](https://www.who.int/news-room/fact-sheets/detail/deafness-and-hearing-loss)), and about 37.5 million adults in the US report some trouble hearing ([NIDCD](https://www.nidcd.nih.gov/health/statistics/quick-statistics-hearing)). Ring and Nest doorbells alert through sound and app pings, which deaf, hard-of-hearing and DeafBlind people can miss.

Today's fix is separate alerting hardware. A Bellman Visit door transmitter ([$119.95](https://www.maxiaids.com/bellman-visit-door-transmitter)) and flash receiver ([$249.95](https://us.bellman.com/collections/visit-receivers)) cost about $370 at US list prices for one door and one room. They react to the chime, not to what the camera saw, so a parcel and a stranger at midnight flash the same way.

## What it does

**AI describes what the camera saw. Plain code decides how urgent it is, and shows why.**

Prism connects Ring's real-time events to Amazon Bedrock, which describes each snapshot, and to an explainable Signal Score, which rates the event Routine, Notable or Urgent. The companion web app, on a phone or computer the household already owns, shows every alert as a visual card, vibrates in a distinct pattern for Notable and Urgent alerts, and sends a push notification for Urgent ones. No extra hardware is needed.

When you've been away, the app's **Catch up** panel answers "What did I miss?", or a question like "Did a package come today?", in a few plain sentences short enough for a braille display. It's a [Strands Agents](https://strandsagents.com) agent on Amazon Bedrock that looks up your recent alerts itself (see `docs/ARCHITECTURE.md`).

What the model decides, and what code decides:

- **The model** describes the snapshot (category, description, confidence) and, in Catch up, chooses what to look up and writes the answer.
- **Code** computes the Signal Score from named factors (what was seen, the model's confidence, time of day, quiet hours, repeat visits, known visitors and the household's feedback), picks the channels, and, in Catch up, works out which alerts are new, which came during sleep hours, and how many there were.

### How Prism uses the Ring API

All Ring calls live in [`packages/prism-backend/src/ring`](packages/prism-backend/src/ring) and are made at runtime.

| What for | Ring API | Code |
| --- | --- | --- |
| Receive doorbell presses and motion, with Smart Alerts sub-types | v1.1 webhooks, verified with `X-Signature` | [`webhookHandler.ts`](packages/prism-backend/src/ring/webhookHandler.ts), [`routes.ts`](packages/prism-backend/src/ring/routes.ts) |
| Get each event's snapshot (webhooks carry no image) | `POST /v1/devices/{id}/media/image/download` | [`ringClient.ts`](packages/prism-backend/src/ring/ringClient.ts), [`snapshots.ts`](packages/prism-backend/src/ring/snapshots.ts) |
| Black out the owner's privacy zones before anything analyzes or shows the image | `GET /v1/devices/{id}/configurations` | [`privacyZones.ts`](packages/prism-backend/src/ring/privacyZones.ts) |
| Name the camera on each alert | `GET /v1/devices` | [`deviceDirectory.ts`](packages/prism-backend/src/ring/deviceDirectory.ts) |
| Pick up events missed while the backend was down | `GET /v1/history/devices/{id}/events` | [`eventHistory.ts`](packages/prism-backend/src/ring/eventHistory.ts) |
| Link a household's Ring account, and unlink it | OAuth token exchange and refresh, `GET /v1/users/me`, `POST` and `PATCH /v1/accounts/me/app-integrations`, the `app_integration_removed` webhook | [`accountLinking.ts`](packages/prism-backend/src/ring/accountLinking.ts), [`oauth.ts`](packages/prism-backend/src/ring/oauth.ts), [`linkPage.ts`](packages/prism-backend/src/ring/linkPage.ts) |

[`docs/RING_READINESS.md`](docs/RING_READINESS.md) checks Prism against what Ring asks of partner apps before certification, including what's still to do.

### How Prism uses AWS

| Service | What for | Code |
| --- | --- | --- |
| Amazon Bedrock: Claude Haiku 4.5, through the US inference profile | Describing each snapshot | [`multimodalContext.ts`](packages/prism-backend/src/bedrock/multimodalContext.ts) |
| Amazon Bedrock: Titan Text Embeddings V2, with pgvector | Recognizing a repeat visit | [`embeddings.ts`](packages/prism-backend/src/bedrock/embeddings.ts), [`repeatVisitorMemory.ts`](packages/prism-backend/src/bedrock/repeatVisitorMemory.ts) |
| Strands Agents on Amazon Bedrock | The Catch up agent and its read-only tools | [`catchUpAgent.ts`](packages/prism-backend/src/summary/catchUpAgent.ts) |
| IAM | A least-privilege policy: `bedrock:InvokeModel` on those two models only | [`bedrock-invoke-policy.json`](infra/aws/bedrock-invoke-policy.json) |
| CloudFormation, EC2, CloudFront, Systems Manager | The live demo, with an instance role instead of stored keys | [`infra/aws/demo`](infra/aws/demo/README.md) |

### Measured

- **Classification:** 33 of 34 labeled photos (97%) classified correctly, including low light, motion blur and look-alike categories. Median 1.6 seconds per event, including scoring.
- **Repeat-visitor matching:** the match threshold (0.60) sits above every similarity measured between different visitors (at most 0.569).
- **Delivery:** the WebSocket broadcast step takes 0.1 ms at the 95th percentile, measured locally over 5,000 deliveries.
- **Accessibility:** zero axe-core violations across every component and page state, and a manual VoiceOver pass of the full alert flow.

Methods and full results are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md).

## Structure

- `packages/prism-alert-engine` — Ring-agnostic core: a Bedrock classification wrapper, the Signal Score engine, and channel encoders (haptic/visual/push). Standalone and MIT-licensed; any doorbell or camera vendor could adopt it directly.
- `packages/prism-backend` — Ring account linking, webhook ingestion and Ring API calls, Bedrock classification + orchestration, Postgres + pgvector event store.
- `apps/prism-companion-web` — the React/PWA companion app that receives alerts in real time.
- `infra/` — the Bedrock IAM policy and AWS setup notes, a CloudFormation template for the public demo, and a docker-compose setup (Postgres, plus an optional containerized backend).
- `docs/` — architecture, accessibility, privacy and Ring readiness notes.

## Setup

Requires Node 22+, Docker, and AWS credentials with Amazon Bedrock access to Claude Haiku 4.5 and Amazon Titan Text Embeddings V2 (`.env.example` defaults to `us-east-2`). The AWS SDK picks credentials up from your AWS CLI profile or environment; they never go in a file in this repo. `infra/aws/README.md` has the one-time model access steps and a least-privilege IAM policy.

```bash
./scripts/setup.sh   # npm install, create packages/prism-backend/.env, start Postgres and migrate
npm run dev          # backend on :3000, companion app on http://localhost:5173
npm run seed         # in a second terminal: replay five simulated doorbell events
```

Open http://localhost:5173 before running `npm run seed`, or skip the second terminal and press **Send a test visitor** in the app, which sends the same events one at a time. Set your household time zone under **Settings** (it starts as UTC): quiet hours, the late-night factor in the Signal Score, and alert times all use it. Each event arrives as a context card with its Signal Class. Notable and Urgent events also vibrate on Android Chrome, and once push is enabled in the app, Urgent events send a Web Push notification.

### Simulator mode (no Ring credentials)

The steps above need no Ring credentials. `npm run seed` sends webhooks in Ring's v1.1 format to `POST /webhooks/ring`, signed in `X-Signature` with the same `RING_WEBHOOK_SECRET` the backend uses, with labeled photos from `packages/prism-backend/eval/fixtures` as the snapshots. From the webhook on, Bedrock classification, the Signal Score, repeat-visitor memory and delivery follow the same path as a live Ring event. The run includes a repeat visit by the first visitor (scored lower by repeat-visitor memory) and ends with a night-time visit, sent with a late-night timestamp in your time zone so it scores as Urgent whatever time you run it. Run `npm run clear-history` between runs to start from a clean slate.

### Connecting to Ring

Prism calls the Ring Partner API at runtime: it downloads each event's snapshot (Ring's webhooks carry no image), blacks out the areas the owner marked as privacy zones in the Ring app before anything analyzes or shows it, looks up the device's name (e.g. "Front Door"), and reads each device's event history to pick up events it missed while it was down. There are two ways to give it access.

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
- `npm run lint` — ESLint (with typescript-eslint) across all workspaces
- `npm run build` — compile every workspace
- `npm run migrate` — apply any new database migrations
- `npm run clear-history` — delete stored alerts, repeat-visitor memory, feedback and visitor tags (keeps settings, push subscriptions and any linked Ring account)
- `npm run eval:repeat --workspace=prism-backend` — measure how well repeat-visitor matching separates the same visitor from different ones (live Bedrock), to tune its thresholds
- `npm run init-env` — fill in generated values missing from `packages/prism-backend/.env` (never overwrites existing ones)
- `npm run ring:devices` — list the Ring devices `RING_ACCESS_TOKEN` can see (live Ring API)
- `npm run forged-webhooks` — send an unsigned and a wrongly signed Ring webhook to a Prism server and check it rejects both with a 401 (set `SIMULATOR_TARGET_URL` to try a deployed server, such as the live demo)

## Personalization and privacy

Prism learns a household's preferences without any account system: quiet hours, per-Signal-Class haptic pattern overrides, and thumbs up/down feedback on each alert's classification (which gradually adjusts the Signal Score's category weights -- see `docs/ARCHITECTURE.md`) are all editable from the companion app's Settings panel.

Known-visitor tagging is a separate, **strictly opt-in** feature, off by default. When a household turns it on, it can label a repeat visitor (e.g. "Mail carrier") so Prism de-escalates future alerts from that same visitor. Tags are matched using on-device/on-backend vector similarity, stored only in this household's own Postgres database, and are never uploaded, shared, or sent to any third party. Turning the feature off stops new tagging immediately; it does not delete tags already saved.

Alert history is kept for 30 days by default (`HISTORY_RETENTION_DAYS`) and can be deleted at any time from Settings > Your data in the companion app. Snapshots aren't stored, and Ring privacy zones are blacked out before a snapshot is analyzed or shown. See `docs/PRIVACY.md` for what Prism stores, what leaves the household's server, and how to delete it.

## Status

The Ring integration follows Ring's Partner API documentation: one-way account linking (token exchange, the signed-nonce Account Link page, token refresh), v1.1 webhook ingestion (X-Signature verification, deduplication), snapshot downloads with privacy zones blacked out, device lookups, and reading the event history for missed events, all through the Ring API. It is covered by tests and exercised end to end with the event simulator, but has not yet been run against a live Ring account. The Signal Score engine is built and tested. Bedrock classification is wired end to end from the webhook receiver through the Signal Score engine to a channel decision. Real-time delivery is live: a WebSocket server broadcasts scored events to the companion web app, and Web Push notifications reach subscribed devices even when the app isn't in focus. Measured WebSocket delivery latency (`npm run measure-delivery-latency`) is sub-millisecond locally -- see `docs/ARCHITECTURE.md` for the methodology and numbers. The companion app itself renders the visual context card and triggers the haptic pattern for each alert.

The catch-up summary is tested with a scripted model standing in for Bedrock, and was checked by hand against the live model. Personalization and session memory are also built and tested: repeat-visitor memory (Bedrock embeddings + pgvector similarity search, scoped to a rolling per-device session window), per-household preferences (quiet hours, haptic overrides, the known-visitor-tagging opt-in), and a feedback loop that adjusts Signal Score category weights from accumulated thumbs up/down votes.

## Accessibility

The companion app targets WCAG 2.2 AA, per the Ring Partner API guideline. An automated `axe-core` pass runs against every component and page state as part of `npm run test` (zero violations), color contrast is verified against the WCAG formula directly from the app's palette, and every interactive element is confirmed keyboard-reachable with no trap via a full keyboard-only navigation walk. A manual pass with VoiceOver in Safari covered the full alert flow: new alerts are announced as they arrive, the catch-up answer is read when it's ready, and every control is labeled. See [docs/ACCESSIBILITY.md](./docs/ACCESSIBILITY.md) for the full checklist and methodology.

## License

MIT — see [LICENSE](./LICENSE). The evaluation fixture photos are from Pexels, under the Pexels License — see [CREDITS.md](./CREDITS.md).
