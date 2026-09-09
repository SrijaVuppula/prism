# prism-alert-engine

Context-to-alert engine: takes a normalized camera event + a Bedrock (or any multimodal LLM) classification, computes an explainable **Signal Score** (0–100) and **Signal Class** (Routine/Notable/Urgent), and encodes it into haptic, visual, and push channel payloads.

**No Ring-specific code** — any doorbell, camera, or security vendor can adopt this package directly.

## Install

```bash
npm install prism-alert-engine
```

## Usage

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

## Why explainable scoring, not a bare LLM opinion

`scoring.ts` is a weighted, line-by-line-defensible function — modeled after an Enthalpy Comfort Index-style domain scoring pattern — not "the model said so." Every factor in the final score is visible in `breakdown`.

## License

MIT
