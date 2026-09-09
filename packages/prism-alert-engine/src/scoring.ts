// The Signal Score engine — the project's core differentiator.
//
// Modeled deliberately after an Enthalpy-Comfort-Index-style pattern: a domain-specific,
// weighted, line-by-line explainable score rather than a bare LLM opinion. Every factor
// below shows up individually in `breakdown`, so it can be defended under judge questioning.
//
// TODO: calibrate weights and thresholds against a labeled test set
// (~30-50 events across all four categories, plus edge cases).

import { EventCategory, ScoringInput, ScoringResult, SignalClass } from "./types";

// Baseline urgency per category before context adjusts it.
const CATEGORY_BASE_WEIGHT: Record<EventCategory, number> = {
  person: 55,
  package: 40,
  vehicle: 25,
  animal: 10,
};

// Score thresholds mapping to discrete Signal Class. Tune against real data.
const URGENT_THRESHOLD = 70;
const NOTABLE_THRESHOLD = 35;

export function computeSignalScore(input: ScoringInput): ScoringResult {
  const breakdown: Record<string, number> = {};

  // 1. Category base weight — what kind of thing was detected.
  breakdown.categoryBase = CATEGORY_BASE_WEIGHT[input.category];

  // 2. Confidence scaling — a low-confidence detection is dampened, never dropped silently.
  //    Maps confidence 0..1 onto a -10..+10 adjustment centered at 0.5.
  breakdown.confidenceAdjustment = Math.round((input.confidence - 0.5) * 20);

  // 3. Time-of-day risk — late night / early morning activity is inherently more notable.
  const isOffHours = input.hourOfDay >= 22 || input.hourOfDay <= 5;
  breakdown.timeOfDay = isOffHours ? 15 : 0;

  // 4. Known-visitor de-escalation — opt-in known-face match lowers urgency.
  breakdown.knownVisitor = input.isKnownVisitor ? -25 : 0;

  // 5. Repeat-visit de-escalation — same visitor again this session window, diminishing
  //    returns so it never fully zeroes out a genuinely new pattern of repeat activity.
  breakdown.repeatVisit =
    input.repeatVisitCount > 0 ? -Math.min(20, input.repeatVisitCount * 8) : 0;

  // 6. Quiet hours — user opted into reduced (not silent) alerting.
  breakdown.quietHours = input.isQuietHours ? -10 : 0;

  const raw = Object.values(breakdown).reduce((sum, v) => sum + v, 0);
  const signalScore = Math.max(0, Math.min(100, Math.round(raw)));

  const signalClass = classify(signalScore);

  return { signalScore, signalClass, breakdown };
}

function classify(score: number): SignalClass {
  if (score >= URGENT_THRESHOLD) return "Urgent";
  if (score >= NOTABLE_THRESHOLD) return "Notable";
  return "Routine";
}
