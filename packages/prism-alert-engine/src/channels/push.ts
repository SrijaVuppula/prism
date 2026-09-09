// Push notification payload builder — Web Push / FCM agnostic.
// Actual dispatch (service worker registration, FCM/Web Push API calls) lives
// in prism-backend; this module only shapes the payload.

import { PrismEvent, PushPayload } from "../types";

export function buildPushPayload(event: PrismEvent): PushPayload {
  if (!event.classification || !event.scoring) {
    throw new Error("buildPushPayload requires a classified and scored event");
  }
  return {
    title: `Prism — ${event.scoring.signalClass}`,
    body: event.classification.description,
    data: {
      eventId: event.id,
      signalClass: event.scoring.signalClass,
      snapshotUrl: event.snapshotUrl,
    },
  };
}
