// Builds the data payload for the companion app's visual context card.
// Markup/rendering lives in apps/prism-companion-web; this just shapes the data.

import { ContextCardPayload, PrismEvent } from "../types";

export function buildContextCard(event: PrismEvent): ContextCardPayload {
  if (!event.classification || !event.scoring) {
    throw new Error("buildContextCard requires a classified and scored event");
  }
  return {
    snapshotUrl: event.snapshotUrl,
    description: event.classification.description,
    signalClass: event.scoring.signalClass,
    timestamp: event.occurredAt,
  };
}
