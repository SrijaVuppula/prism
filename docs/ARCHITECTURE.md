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

## Personalization without an account system

There is no user/auth system anywhere in this codebase, and personalization
doesn't add one as a prerequisite. `preferences/preferencesStore.ts` and
`alert_feedback` both follow the same single-household shape already
established by `push_subscriptions` and the Ring account-linking flow:
preferences are one row, keyed by a constant `household_id` ("default")
rather than a real user id, matching how every push subscription already
receives every alert regardless of who's holding the phone.

That constant is a call-site choice, not a schema one: `household_id` is a
real column on `user_preferences`, not folded away, so swapping
`DEFAULT_HOUSEHOLD_ID` for an authenticated user/household id later doesn't
need a migration. Repeat-visitor memory and known-visitor tags are scoped to
Ring `device_id` instead of a household at all, since a "session window" is
inherently per-camera regardless of how many people are in the household.

## Repeat-visitor memory

Bedrock embedding model → vector per event (the visitor signature, plus optionally the snapshot itself) → `pgvector` similarity search against the current session window → de-escalate Signal Class on a match. Genuine vector search, not keyword/hash matching.

**Session window**: a rolling time window (`SESSION_WINDOW_MINUTES`, default 45), scoped to a single Ring device. Two events count as the same visit when they occur on the same device within that window of each other, not on a fixed clock-aligned bucket -- the window slides forward with every new event. It resets independently per device: there is no cross-device or global session.

**Pipeline**: `bedrock/repeatVisitorMemory.ts` runs after classification and before scoring. Alongside its one-sentence description, the classification prompt asks for a *visitor signature*: a short, lowercase, comma-separated list of the subject's stable visible traits (for a person, clothing items with their colors, headwear, and anything carried). Matching embeds the signature rather than the description, because a description's wording varies between runs on the same snapshot ("red jacket… delivery" one time, "red shirt… clipboard" the next) far more than a list of traits does; a reply without a signature falls back to the description. When `BEDROCK_IMAGE_EMBEDDING_MODEL_ID` is set (e.g. Amazon Titan Multimodal Embeddings, `amazon.titan-embed-image-v1`), the snapshot itself is embedded too, best-effort -- a failed image call just means a text-only match for that event.

`db/vectorStore.ts`'s `findSimilarEvent` compares the event with every prior event on the same device within the window (cosine similarity via pgvector's `<=>` operator) and `pickMatch` applies the rule: a prior event matches when **either** the signature similarity reaches `REPEAT_VISITOR_SIMILARITY_THRESHOLD` (default 0.60 -- see "Measured repeat-visitor matching" below) **or** the image similarity reaches `REPEAT_VISITOR_IMAGE_SIMILARITY_THRESHOLD` (default 0.92); the strongest qualifying match wins, and the log line says which signal matched. The image threshold is high on purpose: every frame from one doorbell camera shares the same background, so the image signal alone should only match a near-identical frame -- someone still standing at the door across several motion events. This event's embeddings are then recorded under whichever visitor group applies -- the matched group, or a freshly minted one -- so the chain keeps extending. `repeatVisitCount` (how many prior events are in that group within the window) always feeds into scoring; it doesn't persist any identity, just a same-session repetition count.

**Choosing the thresholds**: `npm run eval:repeat --workspace=prism-backend` classifies a sample of the fixture snapshots twice each with live Bedrock and reports, for signatures, descriptions and (when enabled) snapshot images, how similar the same snapshot is to itself across runs versus how similar different snapshots are, with a suggested threshold when the two groups separate cleanly.

**Known-visitor tagging is a separate, opt-in layer on top of this.** `isKnownVisitor` stays false regardless of repeatVisitCount unless the household has turned on known-visitor tagging in Settings *and* that specific visitor group has been tagged (`db/knownVisitorTagStore.ts`) -- see docs/ACCESSIBILITY.md's privacy note. This is why `scoring.ts` has always had `knownVisitor` and `repeatVisit` as two separate breakdown factors: they're independently derived, one automatic and identity-free, the other opt-in and persistent.

**Personalization inputs**: `agentOrchestration.ts` resolves quiet hours and haptic overrides from `preferences/preferencesStore.ts`, and a feedback-derived scoring-weight bias from `feedback/weightAdjustment.ts` (see "Feedback loop" below), on every pipeline run. Each of these -- preferences, repeat-visitor memory, and scoring weights -- is best-effort: a lookup failure is logged and falls back to the conservative default rather than ever blocking alert delivery on Postgres being reachable.

## Feedback loop

Each `ContextCard` in the companion app offers a thumbs up/down on that alert's classification (`POST /alerts/:eventId/feedback`, stored in `alert_feedback`). `feedback/weightAdjustment.ts` aggregates up/down counts per category (minimum 3 votes before a category's weight moves at all) into a bounded bias (±15) on that category's `SignalScoreWeights.categoryBase`, cached for 60s so a burst of events doesn't mean a Postgres round trip per alert. The bias shows up as `breakdown.feedbackAdjustment` in `ScoringResult` whenever non-zero -- exactly as explainable as every hand-written factor, not an opaque model doing the adjusting.

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

### Measured Bedrock classification accuracy and latency

`npm run eval` (from `packages/prism-backend`) runs the real `runPipeline()`
-- real Bedrock InvokeModel calls, no mocks -- against a 34-event labeled
dataset spanning person/package/vehicle/animal categories. Each event is a
real photo chosen to stress a specific edge case (low light, motion blur,
partial framing, multiple subjects, look-alike categories, etc. -- see
`eval/dataset.ts` and `eval/fixtures/README.md`).

Latest run (October 6, 2026, classifying at temperature 0; model
`us.anthropic.claude-haiku-4-5-20251001-v1:0`, region `us-east-2`):

| category | accuracy |
| --- | --- |
| person | 9/10 (90%) |
| package | 8/8 (100%) |
| vehicle | 8/8 (100%) |
| animal | 8/8 (100%) |
| **overall** | **33/34 (97%)** |

| mean | p50 | p95 | max |
| --- | --- | --- | --- |
| 1804 ms | 1635 ms | 3082 ms | 4861 ms |

The one misclassification (`person-with-dog`, expected `person`, predicted
`animal`) is a real ambiguous case rather than a pipeline bug: the dog is
more visually prominent in the frame than the person walking it. It has
been the only miss in every run so far. Earlier runs at the default
temperature measured mean 1696 ms, p50 1612 ms, p95 2575 ms, max 2724 ms
(with the visitor-signature prompt) and mean 1998 ms, p50 1764 ms, p95
3670 ms, max 3783 ms (before it); the slowest event in the latest run
(`person-far-from-camera`) spent 4853 ms in the Bedrock call alone, so the
spread between runs is Bedrock round-trip variance. This latency covers
classification, scoring and the channel decision -- the eval skips delivery,
since there's no WebSocket server or push subscriber in an eval run -- not
just the isolated Bedrock call; see "Latency notes" above for where the
Bedrock-only round-trip is logged separately.

Bedrock rejects some oversized source images with a generic InvokeModel
failure rather than a descriptive error; resizing fixtures to at most
1568x1568px / ~85% JPEG quality resolved every such failure encountered
while building this dataset. All fixtures but one are at or below that
size (`package-partial-frame.jpg` is 3000x2000, about 0.5 MB, and
classifies fine). Worth keeping in mind for anyone feeding in un-resized
camera exports.

### Measured repeat-visitor matching

`npm run eval:repeat` (from `packages/prism-backend`) classifies 10 fixture
snapshots twice each with live Bedrock and compares the embedded text of
the two runs of each snapshot ("same visitor") against every pair of
different snapshots ("different visitors"). Three runs on October 6, 2026
(Titan Text Embeddings V2, 1024 dimensions); runs 1 and 2 classified at the
default temperature (1.0), run 3 at temperature 0:

| text embedded | same visitor: min / mean | different visitors: max / mean |
| --- | --- | --- |
| visitor signature, run 1 | 0.634 / 0.847 | 0.569 / 0.216 |
| visitor signature, run 2 | 0.654 / 0.827 | 0.510 / 0.220 |
| visitor signature, run 3 | 1.000 / 1.000 | 0.552 / 0.207 |
| description, run 1 | 0.739 / 0.850 | 0.598 / 0.232 |
| description, run 2 | 0.605 / 0.846 | 0.569 / 0.235 |
| description, run 3 | 1.000 / 1.000 | 0.589 / 0.239 |

The previous threshold of 0.85 sat right at the *average* same-visitor
similarity of runs 1 and 2, so about half of genuine repeat visits went
unrecognized. In those runs the lowest same-visitor signature similarity
(0.634) stays above the highest different-visitor one (0.569); for
descriptions the two nearly touch (0.605 vs 0.598), which is why matching
uses signatures. The default `REPEAT_VISITOR_SIMILARITY_THRESHOLD` of 0.60
is the midpoint of runs 1 and 2.

Even so, a simulator repeat visit -- the same photo sent twice -- scored
0.600 against the first visit and was missed, because at the default
temperature the model words its description of one image differently on
each call. Classification now runs at temperature 0, and run 3 shows the
two descriptions of each snapshot coming back identical. That makes run
3's same-visitor column a check of determinism rather than of drift: a real
repeat visit is a different frame of the same person, described from a
different pose and light, and runs 1 and 2 are the better guide to how far
those descriptions can drift apart. So the threshold stays at 0.60 rather
than run 3's suggested 0.78; it is above every different-visitor similarity
measured in the three runs (at most 0.569).

The most alike different visitors were all people (e.g. two different
people in dark jackets and light trousers at 0.552-0.569), so that is where
a false match would come from; a false match lowers the score by 8 per
repeat visit (at most 20), which rarely changes the Signal Class. This
sample has 10 snapshots and no pairs of the same person in different
frames, so re-run the tool as the dataset grows.
