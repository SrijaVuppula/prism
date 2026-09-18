# prism-alert-engine

Context-to-alert engine: takes a normalized camera event + a Bedrock (or any multimodal LLM) classification, computes an explainable **Signal Score** (0–100) and **Signal Class** (Routine/Notable/Urgent), and encodes it into haptic, visual, and push channel payloads.

**No Ring-specific code** — any doorbell, camera, or security vendor can adopt this package directly.

## Install

```bash
npm install prism-alert-engine
```

## Usage

### Scoring an event

```ts
import { computeSignalScore, encodeHapticPattern } from "prism-alert-engine";

const result = computeSignalScore({
  category: "person",
  confidence: 0.92,
  hourOfDay: 23,
  isKnownVisitor: false,
  repeatVisitCount: 0,
  isQuietHours: false,
});

console.log(result.signalScore, result.signalClass, result.breakdown);

const pattern = encodeHapticPattern(result.signalClass);
navigator.vibrate(pattern);
```

### Full pipeline: classify → score → deliver

```ts
import {
  StubClassifier,
  computeSignalScore,
  buildContextCard,
  buildPushPayload,
  encodeHapticPattern,
  type PrismEvent,
} from "prism-alert-engine";

// Swap StubClassifier for your own Classifier implementation
// (e.g. a Bedrock-backed one) in production.
const classifier = new StubClassifier();

const event: PrismEvent = {
  id: "evt_1",
  occurredAt: new Date().toISOString(),
  snapshotUrl: "https://cdn.example.com/snap/evt_1.jpg",
};

event.classification = await classifier.classify(event.snapshotUrl);
event.scoring = computeSignalScore({
  category: event.classification.category,
  confidence: event.classification.confidence,
  hourOfDay: new Date().getHours(),
  isKnownVisitor: false,
  repeatVisitCount: 0,
  isQuietHours: false,
});

const contextCard = buildContextCard(event); // → companion app's visual card
const pushPayload = buildPushPayload(event); // → Web Push / FCM
const hapticPattern = encodeHapticPattern(event.scoring.signalClass); // → Web Vibration API
```

## Why explainable scoring, not a bare LLM opinion

`scoring.ts` is a weighted, line-by-line-defensible function — modeled after an Enthalpy Comfort Index-style domain scoring pattern — not "the model said so." Every factor in the final score is visible in `breakdown`.

## Testing

```bash
npm test
```

Vitest, mirroring `src/` under `tests/`: one test file per source file, covering `scoring`, `classifier`, and each channel encoder (`haptic`, `visual`, `push`).

## License

MIT
