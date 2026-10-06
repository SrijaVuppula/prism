// WebSocket message shape shared with prism-backend/src/api/websocket.ts.
// Re-declared here (rather than imported from prism-backend) because the
// backend package pulls in Node-only dependencies (AWS SDK, pg, express)
// that have no place in a browser bundle; prism-alert-engine is the one
// package deliberately kept safe to share between both.

import type { ContextCardPayload, HapticOverrides, PrismEvent, PushPayload } from "prism-alert-engine";

export interface ChannelPayloads {
  haptic?: number[];
  visual?: ContextCardPayload;
  push?: PushPayload;
}

/** The device an event came from: its name from the Ring API, or the event's own label. */
export interface CompanionDevice {
  id: string;
  name: string;
}

export interface CompanionEventMessage {
  type: "prism-event";
  event: PrismEvent;
  channels: ChannelPayloads;
  device?: CompanionDevice;
}

// Preference shapes re-declared here rather than imported from
// prism-backend, for the same reason CompanionEventMessage is above:
// prism-backend pulls in Node-only dependencies with no place in a browser
// bundle. Kept in sync by hand with prism-backend/src/preferences/preferencesStore.ts.
export interface QuietHours {
  enabled: boolean;
  /** Local hour (0-23) in the household's time zone. */
  startHour: number;
  endHour: number;
}

export interface UserPreferences {
  /** IANA time zone name, e.g. "America/New_York". */
  timeZone: string;
  hapticOverrides: HapticOverrides;
  quietHours: QuietHours;
  knownVisitorTaggingEnabled: boolean;
}
