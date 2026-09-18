// Orchestration chain: normalized event -> Bedrock classification -> Signal
// Score -> channel decision -> dispatch.
//
// This is a plain, linear async chain rather than a standalone agent
// framework (AgentCore/Strands): there's no multi-step tool-calling or
// planning here, just a fixed sequence, so a framework would add
// indirection without buying anything yet. Revisit if a later step needs
// the model to choose between actions rather than follow this fixed order.
//
// Dispatch fans the channel payloads out over two independent paths: a
// WebSocket broadcast to any companion app connected right now
// (api/websocket.ts), and -- when the Signal Class calls for it -- Web Push
// so an alert still lands when the app isn't in focus (push/dispatchPush.ts).
// Both are best-effort: a delivery failure is logged, not thrown, so it
// never turns a successfully classified and scored event into a rejected
// pipeline promise.
//
// Personalization is layered on the same way: preferences, repeat-visitor
// memory, and the feedback-driven scoring weights are each best-effort --
// a lookup failure logs a warning and falls back to the conservative
// default rather than ever blocking alert delivery on Postgres being
// reachable.

import {
  buildContextCard,
  buildPushPayload,
  computeSignalScore,
  DEFAULT_SIGNAL_SCORE_WEIGHTS,
  encodeHapticPattern,
  type ClassificationResult,
  type ContextCardPayload,
  type HapticOverrides,
  type PrismEvent,
  type PushPayload,
  type ScoringInput,
  type ScoringResult,
  type SignalClass,
  type SignalScoreWeights,
} from "prism-alert-engine";
import { classifySnapshot } from "./multimodalContext";
import { resolveRepeatVisitor } from "./repeatVisitorMemory";
import { broadcastEvent } from "../api/websocket";
import { dispatchPushNotifications } from "../push/dispatchPush";
import { resolveSignalScoreWeights } from "../feedback/weightAdjustment";
import { DEFAULT_PREFERENCES, getPreferencesStore, type UserPreferences } from "../preferences/preferencesStore";
import { isWithinQuietHours } from "../preferences/quietHours";

/**
 * Context inputs to the Signal Score engine that don't come from
 * classification alone:
 * - isKnownVisitor / repeatVisitCount come from repeat-visitor session
 *   memory (repeatVisitorMemory.ts / ../db/vectorStore.ts).
 * - isQuietHours comes from the household's preferences
 *   (../preferences/preferencesStore.ts).
 *
 * Pass an explicit context to skip all of that and use fixed values instead
 * (tests, the eval harness, or any caller that already knows better) --
 * runPipeline() only resolves these for real when `context` is omitted.
 */
export interface OrchestrationContext {
  isKnownVisitor: boolean;
  repeatVisitCount: number;
  isQuietHours: boolean;
}

export const DEFAULT_ORCHESTRATION_CONTEXT: OrchestrationContext = {
  isKnownVisitor: false,
  repeatVisitCount: 0,
  isQuietHours: false,
};

export interface ChannelPayloads {
  haptic?: number[];
  visual?: ContextCardPayload;
  push?: PushPayload;
}

export interface PipelineResult {
  event: PrismEvent;
  channels: ChannelPayloads;
}

// Which channels fire at each Signal Class. Routine still gets a visual
// card (so the companion app's context-card history is complete) but skips
// haptic/push; Notable adds haptic; Urgent adds push on top of that.
const CHANNELS_BY_SIGNAL_CLASS: Record<SignalClass, Array<keyof ChannelPayloads>> = {
  Routine: ["visual"],
  Notable: ["visual", "haptic"],
  Urgent: ["visual", "haptic", "push"],
};

/**
 * Hour of day (0-23) for the given ISO timestamp, in UTC.
 * TODO: ScoringInput wants the device's local hour; that needs the Ring
 * device's timezone threaded through from device metadata, which isn't
 * available yet. UTC is used as a deterministic placeholder rather than the
 * server process's arbitrary local timezone.
 */
function hourOfDay(occurredAt: string): number {
  return new Date(occurredAt).getUTCHours();
}

function decideChannels(
  scoredEvent: PrismEvent,
  scoring: ScoringResult,
  hapticOverrides: HapticOverrides = {},
): ChannelPayloads {
  const channels: ChannelPayloads = {};
  for (const channel of CHANNELS_BY_SIGNAL_CLASS[scoring.signalClass]) {
    if (channel === "visual") channels.visual = buildContextCard(scoredEvent);
    if (channel === "haptic") {
      channels.haptic = hapticOverrides[scoring.signalClass] ?? encodeHapticPattern(scoring.signalClass);
    }
    if (channel === "push") channels.push = buildPushPayload(scoredEvent);
  }
  return channels;
}

/**
 * Best-effort preference lookup: falls back to DEFAULT_PREFERENCES (no
 * quiet hours, no haptic overrides, known-visitor tagging off) rather than
 * ever letting a Postgres hiccup block classification/scoring/dispatch.
 */
async function resolvePreferences(eventId: string): Promise<UserPreferences> {
  try {
    return await getPreferencesStore().get();
  } catch (err) {
    console.error(`[orchestration] preferences lookup failed for event ${eventId}, using defaults:`, err);
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Best-effort scoring-weights lookup (hand-tuned defaults plus the
 * feedback-derived per-category bias). Falls back to
 * DEFAULT_SIGNAL_SCORE_WEIGHTS on any failure -- the feedback loop is a
 * refinement, never a dependency of scoring working at all.
 */
async function resolveWeights(eventId: string): Promise<SignalScoreWeights> {
  try {
    return await resolveSignalScoreWeights();
  } catch (err) {
    console.error(`[orchestration] scoring-weight resolution failed for event ${eventId}, using defaults:`, err);
    return DEFAULT_SIGNAL_SCORE_WEIGHTS;
  }
}

/**
 * Resolves the real OrchestrationContext for an event: quiet hours from
 * preferences, plus repeat-visitor memory when the event has a deviceId to
 * scope a session window to (see repeatVisitorMemory.ts). Best-effort --
 * any failure here logs and falls back to DEFAULT_ORCHESTRATION_CONTEXT's
 * values for whichever part failed.
 */
async function resolveOrchestrationContext(
  event: PrismEvent,
  classification: ClassificationResult,
  preferences: UserPreferences,
): Promise<{ context: OrchestrationContext; visitorGroupId?: string }> {
  const isQuietHours = isWithinQuietHours(new Date(event.occurredAt), preferences.quietHours);

  if (!event.deviceId) {
    return { context: { isKnownVisitor: false, repeatVisitCount: 0, isQuietHours } };
  }

  try {
    const memory = await resolveRepeatVisitor(event, classification, preferences.knownVisitorTaggingEnabled);
    return {
      context: { isKnownVisitor: memory.isKnownVisitor, repeatVisitCount: memory.repeatVisitCount, isQuietHours },
      visitorGroupId: memory.visitorGroupId,
    };
  } catch (err) {
    console.error(`[orchestration] repeat-visitor memory lookup failed for event ${event.id}, using defaults:`, err);
    return { context: { isKnownVisitor: false, repeatVisitCount: 0, isQuietHours } };
  }
}

/**
 * Pushes the scored event to connected companion clients over WebSocket and,
 * when the channel decision calls for it, dispatches Web Push. Both are
 * best-effort -- a failure here is logged and swallowed rather than
 * rethrown, since the classification and scoring already succeeded and
 * shouldn't be reported as a pipeline failure just because delivery hiccuped.
 */
async function dispatch(scoredEvent: PrismEvent, channels: ChannelPayloads): Promise<void> {
  try {
    broadcastEvent({ type: "prism-event", event: scoredEvent, channels });
  } catch (err) {
    console.error(`[orchestration] WebSocket broadcast failed for event ${scoredEvent.id}:`, err);
  }

  if (channels.push) {
    try {
      await dispatchPushNotifications(channels.push);
    } catch (err) {
      console.error(`[orchestration] push dispatch failed for event ${scoredEvent.id}:`, err);
    }
  }
}

export async function runPipeline(event: PrismEvent, context?: OrchestrationContext): Promise<PipelineResult> {
  const startedAt = Date.now();

  const classification = await classifySnapshot(event.snapshotUrl);
  const preferences = await resolvePreferences(event.id);

  let resolvedContext: OrchestrationContext;
  let visitorGroupId: string | undefined;
  if (context) {
    resolvedContext = context;
  } else {
    const resolved = await resolveOrchestrationContext(event, classification, preferences);
    resolvedContext = resolved.context;
    visitorGroupId = resolved.visitorGroupId;
  }

  const weights = await resolveWeights(event.id);

  const scoringInput: ScoringInput = {
    category: classification.category,
    confidence: classification.confidence,
    hourOfDay: hourOfDay(event.occurredAt),
    isKnownVisitor: resolvedContext.isKnownVisitor,
    repeatVisitCount: resolvedContext.repeatVisitCount,
    isQuietHours: resolvedContext.isQuietHours,
  };
  const scoring = computeSignalScore(scoringInput, weights);

  const scoredEvent: PrismEvent = { ...event, classification, scoring, visitorGroupId };
  const channels = decideChannels(scoredEvent, scoring, preferences.hapticOverrides);

  console.log(
    `[orchestration] event=${event.id} category=${classification.category} ` +
      `signalScore=${scoring.signalScore} signalClass=${scoring.signalClass} ` +
      `classifyLatencyMs=${Date.now() - startedAt}`,
  );

  await dispatch(scoredEvent, channels);

  console.log(
    `[orchestration] event=${event.id} delivered totalLatencyMs=${Date.now() - startedAt}`,
  );

  return { event: scoredEvent, channels };
}
