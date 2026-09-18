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
  /**
   * Identifier of the physical device/camera this event came from, when the
   * source integration has one (e.g. a Ring device id). Optional and
   * generic on purpose -- this package stays camera/vendor-agnostic -- but
   * it's what repeat-visitor session memory in prism-backend scopes its
   * lookups to, since "session window" is inherently per-device.
   */
  deviceId?: string;
  /**
   * Stable id for the cluster of visually-similar events this one has been
   * grouped with by repeat-visitor memory (prism-backend/src/db/vectorStore.ts).
   * Undefined until that lookup has run. Carried on the event (rather than
   * only on internal orchestration state) so the companion app can offer an
   * opt-in "tag this visitor" action against a stable id.
   */
  visitorGroupId?: string;
}

/** Payload sent to the companion app's visual context card. */
export interface ContextCardPayload {
  snapshotUrl: string;
  description: string;
  signalClass: SignalClass;
  timestamp: string;
}

/**
 * Per-Signal-Class haptic pattern override (Web Vibration API on/off pairs,
 * ms). Partial -- a signal class with no override falls back to
 * encodeHapticPattern()'s default from channels/haptic.ts. Lives here
 * (rather than only in prism-backend) since the companion app also needs
 * the shape to render/edit its settings UI without importing prism-backend.
 */
export type HapticOverrides = Partial<Record<SignalClass, number[]>>;

/** Minimal push notification payload (Web Push / FCM agnostic). */
export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}
