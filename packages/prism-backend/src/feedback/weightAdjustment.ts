// Turns accumulated thumbs up/down feedback into a SignalScoreWeights
// adjustment -- the actual self-improvement loop, not just a stored
// opinion: a category the household consistently downvotes gets a lower
// base weight (so it scores lower, more often Routine, going forward); one
// consistently upvoted gets a higher one. The bias is exposed in
// ScoringResult.breakdown.feedbackAdjustment whenever non-zero, so a
// learned adjustment is exactly as explainable as every hand-written factor
// in prism-alert-engine/src/scoring.ts.
//
// prism-alert-engine itself stays a pure, storage-free scoring function --
// all of the "learning" (reading feedback, computing a bias, caching it)
// happens here in prism-backend and is handed to computeSignalScore() as
// plain data.

import { DEFAULT_SIGNAL_SCORE_WEIGHTS, type EventCategory, type SignalScoreWeights } from "prism-alert-engine";
import { getFeedbackStore, type CategoryFeedbackTally } from "./feedbackStore";

/** A category needs at least this many total votes before feedback moves its weight at all. */
const MIN_VOTES_FOR_ADJUSTMENT = 3;
/** Score points of bias per net vote (upvotes - downvotes), before capping. */
const BIAS_PER_NET_VOTE = 1.5;
/** Maximum magnitude of the learned bias in either direction, so feedback nudges rather than overrides. */
const MAX_BIAS_MAGNITUDE = 15;
/** How long a resolved weights object is reused before feedback is re-read from storage. */
const CACHE_TTL_MS = 60_000;

/**
 * Pure function: tally -> bias. Kept separate from any storage access so
 * the learning rule itself is trivially unit-testable.
 */
export function computeCategoryFeedbackBias(tally: CategoryFeedbackTally): Partial<Record<EventCategory, number>> {
  const bias: Partial<Record<EventCategory, number>> = {};

  for (const [category, votes] of Object.entries(tally) as Array<[EventCategory, { up: number; down: number }]>) {
    if (!votes) continue;
    const total = votes.up + votes.down;
    if (total < MIN_VOTES_FOR_ADJUSTMENT) continue;

    const netVotes = votes.up - votes.down;
    const raw = netVotes * BIAS_PER_NET_VOTE;
    const clamped = Math.max(-MAX_BIAS_MAGNITUDE, Math.min(MAX_BIAS_MAGNITUDE, raw));
    if (clamped !== 0) {
      bias[category] = Math.round(clamped);
    }
  }

  return bias;
}

let cache: { weights: SignalScoreWeights; expiresAt: number } | undefined;

/**
 * Resolves the current scoring weights: the hand-tuned defaults plus a
 * feedback-derived per-category bias, cached briefly so a burst of events
 * doesn't mean a Postgres round trip per alert. Callers should treat a
 * rejected promise as "use DEFAULT_SIGNAL_SCORE_WEIGHTS instead" --
 * scoring must never block on the feedback loop being available.
 */
export async function resolveSignalScoreWeights(
  store: { getCategoryTally(): Promise<CategoryFeedbackTally> } = getFeedbackStore(),
): Promise<SignalScoreWeights> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.weights;
  }

  const tally = await store.getCategoryTally();
  const categoryFeedbackBias = computeCategoryFeedbackBias(tally);
  const weights: SignalScoreWeights = { ...DEFAULT_SIGNAL_SCORE_WEIGHTS, categoryFeedbackBias };

  cache = { weights, expiresAt: now + CACHE_TTL_MS };
  return weights;
}

/** Test/dev-only: forces the next resolveSignalScoreWeights() call to re-read from storage. */
export function resetSignalScoreWeightsCache(): void {
  cache = undefined;
}
