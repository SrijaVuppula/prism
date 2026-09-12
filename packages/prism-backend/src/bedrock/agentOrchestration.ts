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

import {
  buildContextCard,
  buildPushPayload,
  computeSignalScore,
  encodeHapticPattern,
  type ContextCardPayload,
  type PrismEvent,
  type PushPayload,
  type ScoringInput,
  type ScoringResult,
  type SignalClass,
} from "prism-alert-engine";
import { classifySnapshot } from "./multimodalContext";
import { broadcastEvent } from "../api/websocket";
import { dispatchPushNotifications } from "../push/dispatchPush";

/**
 * Context inputs to the Signal Score engine that this pipeline cannot yet
 * derive on its own:
 * - isKnownVisitor / repeatVisitCount depend on the repeat-visitor vector
 *   search (../db/vectorStore.ts), which is still a stub.
 * - isQuietHours depends on a per-user preference that doesn't exist yet.
 * Callers can pass real values once those exist; until then the pipeline
 * runs with the conservative defaults below (nothing de-escalated).
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

function decideChannels(scoredEvent: PrismEvent, scoring: ScoringResult): ChannelPayloads {
  const channels: ChannelPayloads = {};
  for (const channel of CHANNELS_BY_SIGNAL_CLASS[scoring.signalClass]) {
    if (channel === "visual") channels.visual = buildContextCard(scoredEvent);
    if (channel === "haptic") channels.haptic = encodeHapticPattern(scoring.signalClass);
    if (channel === "push") channels.push = buildPushPayload(scoredEvent);
  }
  return channels;
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

export async function runPipeline(
  event: PrismEvent,
  context: OrchestrationContext = DEFAULT_ORCHESTRATION_CONTEXT,
): Promise<PipelineResult> {
  const startedAt = Date.now();

  const classification = await classifySnapshot(event.snapshotUrl);

  const scoringInput: ScoringInput = {
    category: classification.category,
    confidence: classification.confidence,
    hourOfDay: hourOfDay(event.occurredAt),
    isKnownVisitor: context.isKnownVisitor,
    repeatVisitCount: context.repeatVisitCount,
    isQuietHours: context.isQuietHours,
  };
  const scoring = computeSignalScore(scoringInput);

  const scoredEvent: PrismEvent = { ...event, classification, scoring };
  const channels = decideChannels(scoredEvent, scoring);

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
