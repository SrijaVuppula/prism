// Shared types for prism-alert-engine.
// Deliberately camera/vendor-agnostic — nothing here references Ring.

export type EventCategory = "person" | "package" | "vehicle" | "animal";

export type SignalClass = "Routine" | "Notable" | "Urgent";

/** Output of the multimodal classification step (e.g. Bedrock). */
export interface ClassificationResult {
  category: EventCategory;
  description: string; // one-line plain-English description
  confidence: number; // 0-1
}

/** Input to the Signal Score engine. */
export interface ScoringInput {
  category: EventCategory;
  confidence: number; // 0-1, from ClassificationResult
  hourOfDay: number; // 0-23, local time at the device
  isKnownVisitor: boolean; // opt-in known-face match only
  repeatVisitCount: number; // matches within the current session window
  isQuietHours: boolean; // user-configured quiet hours preference
}

/** Output of the Signal Score engine. Every field is explainable. */
export interface ScoringResult {
  signalScore: number; // 0-100
  signalClass: SignalClass;
  breakdown: Record<string, number>; // per-factor contribution, so the score is fully explainable
}

/** Normalized event shape used across the pipeline (mirrors PrismEvent in prism-backend). */
export interface PrismEvent {
  id: string;
  occurredAt: string; // ISO timestamp
  snapshotUrl: string;
  classification?: ClassificationResult;
  scoring?: ScoringResult;
}

/** Payload sent to the companion app's visual context card. */
export interface ContextCardPayload {
  snapshotUrl: string;
  description: string;
  signalClass: SignalClass;
  timestamp: string;
}

/** Minimal push notification payload (Web Push / FCM agnostic). */
export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}
