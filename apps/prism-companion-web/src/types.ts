// WebSocket message shape shared with prism-backend/src/api/websocket.ts.
// Re-declared here (rather than imported from prism-backend) because the
// backend package pulls in Node-only dependencies (AWS SDK, pg, express)
// that have no place in a browser bundle; prism-alert-engine is the one
// package deliberately kept safe to share between both.

import type { ContextCardPayload, PrismEvent, PushPayload } from "prism-alert-engine";

export interface ChannelPayloads {
  haptic?: number[];
  visual?: ContextCardPayload;
  push?: PushPayload;
}

export interface CompanionEventMessage {
  type: "prism-event";
  event: PrismEvent;
  channels: ChannelPayloads;
}
