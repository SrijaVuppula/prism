// The Signal Score engine.
//
// Modeled deliberately after an Enthalpy-Comfort-Index-style pattern: a domain-specific,
// weighted, line-by-line explainable score rather than a bare LLM opinion. Every factor
// below shows up individually in `breakdown`, so the result can be inspected and explained
// after the fact instead of taken on faith.
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

/**
 * Tunable weights behind every scoring factor. Kept as data (rather than
 * inlined constants) so the feedback loop in prism-backend
 * (src/feedback/weightAdjustment.ts) can supply an adjusted set derived from
 * accumulated thumbs up/down votes, without this package knowing anything
 * about how that adjustment is computed or where feedback is stored --
 * prism-alert-engine stays a pure, dependency-free scoring function either
 * way.
 */
export interface SignalScoreWeights {
  /** Baseline urgency per category before context adjusts it. */
  categoryBase: Record<EventCategory, number>;
  /**
   * Per-category adjustment layered on top of categoryBase, derived from
   * accumulated user feedback (thumbs up/down). Absent/zero for a category
   * with no feedback yet -- the loop only nudges categories it has evidence
   * for. Shown in `breakdown.feedbackAdjustment` whenever non-zero, so a
   * learned adjustment is exactly as explainable as every other factor.
   */
  categoryFeedbackBias: Partial<Record<EventCategory, number>>;
  /** Late night / early morning bonus (hourOfDay >= offHoursStart || <= offHoursEnd). */
  offHoursBonus: number;
  offHoursStart: number; // hour, 0-23 inclusive
  offHoursEnd: number; // hour, 0-23 inclusive
  /** Opt-in known-face match de-escalation (applied once, not per repeat). */
  knownVisitorAdjustment: number;
  /** Per-repeat-visit de-escalation, applied up to repeatVisitCap. */
  repeatVisitPerVisit: number;
  repeatVisitCap: number;
  /** User-configured quiet hours de-escalation. */
  quietHoursAdjustment: number;
}

export const DEFAULT_SIGNAL_SCORE_WEIGHTS: SignalScoreWeights = {
  categoryBase: CATEGORY_BASE_WEIGHT,
  categoryFeedbackBias: {},
  offHoursBonus: 15,
  offHoursStart: 22,
  offHoursEnd: 5,
  knownVisitorAdjustment: -25,
  repeatVisitPerVisit: -8,
  repeatVisitCap: -20,
  quietHoursAdjustment: -10,
};

export function computeSignalScore(
  input: ScoringInput,
  weights: SignalScoreWeights = DEFAULT_SIGNAL_SCORE_WEIGHTS,
): ScoringResult {
  const breakdown: Record<string, number> = {};

  // 1. Category base weight — what kind of thing was detected.
  breakdown.categoryBase = weights.categoryBase[input.category];

  // 1b. Feedback-driven adjustment — learned from accumulated thumbs up/down
  //     for this category (see prism-backend/src/feedback/weightAdjustment.ts).
  //     Only shown when non-zero so an unadjusted category's breakdown looks
  //     exactly as it did before the feedback loop existed.
  const feedbackBias = weights.categoryFeedbackBias[input.category] ?? 0;
  if (feedbackBias !== 0) {
    breakdown.feedbackAdjustment = feedbackBias;
  }

  // 2. Confidence scaling — a low-confidence detection is dampened, never dropped silently.
  //    Maps confidence 0..1 onto a -10..+10 adjustment centered at 0.5.
  breakdown.confidenceAdjustment = Math.round((input.confidence - 0.5) * 20);

  // 3. Time-of-day risk — late night / early morning activity is inherently more notable.
  const isOffHours = input.hourOfDay >= weights.offHoursStart || input.hourOfDay <= weights.offHoursEnd;
  breakdown.timeOfDay = isOffHours ? weights.offHoursBonus : 0;

  // 4. Known-visitor de-escalation — opt-in known-face match lowers urgency.
  breakdown.knownVisitor = input.isKnownVisitor ? weights.knownVisitorAdjustment : 0;

  // 5. Repeat-visit de-escalation — same visitor again this session window, diminishing
  //    returns so it never fully zeroes out a genuinely new pattern of repeat activity.
  breakdown.repeatVisit =
    input.repeatVisitCount > 0
      ? -Math.min(-weights.repeatVisitCap, input.repeatVisitCount * -weights.repeatVisitPerVisit)
      : 0;

  // 6. Quiet hours — user opted into reduced (not silent) alerting.
  breakdown.quietHours = input.isQuietHours ? weights.quietHoursAdjustment : 0;

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
