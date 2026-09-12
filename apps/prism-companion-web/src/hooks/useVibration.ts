// Triggers the Web Vibration API pattern for the latest event's Signal
// Class. Keyed on event id (not pattern contents) so two consecutive alerts
// of the same Signal Class each still vibrate -- deduping on pattern value
// would silently swallow the second alert.
//
// Silently does nothing on browsers without Vibration API support (notably
// iOS Safari): the visual context card and push notification still carry
// the alert there. See docs/ACCESSIBILITY.md for the pattern table.

import { useEffect, useRef } from "react";
import type { CompanionEventMessage } from "../types";

export function useVibration(message: CompanionEventMessage | null): void {
  const lastEventId = useRef<string | null>(null);

  useEffect(() => {
    const pattern = message?.channels.haptic;
    if (!message || !pattern || pattern.length === 0) return;
    if (message.event.id === lastEventId.current) return;
    lastEventId.current = message.event.id;

    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(pattern);
    }
  }, [message]);
}
