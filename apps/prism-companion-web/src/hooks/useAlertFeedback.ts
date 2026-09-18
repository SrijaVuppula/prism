// Thumbs up/down feedback on an alert's classification
// (prism-backend/src/feedback/routes.ts). Vote state is kept in memory only
// (per component tree, this session) -- there's no need to persist it in
// the browser since the backend is the source of truth and a page reload
// re-renders from a fresh WebSocket history anyway.

import { useCallback, useState } from "react";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import { resolveApiBase } from "../lib/apiBase";

export type FeedbackVote = "up" | "down";

export interface UseAlertFeedbackResult {
  /** The vote recorded for a given event id this session, if any. */
  voteFor: (eventId: string) => FeedbackVote | undefined;
  /** True while a vote for this event id is in flight. */
  isSubmitting: (eventId: string) => boolean;
  submitFeedback: (input: {
    eventId: string;
    vote: FeedbackVote;
    category: EventCategory;
    signalClass: SignalClass;
    signalScore: number;
  }) => Promise<void>;
}

export function useAlertFeedback(): UseAlertFeedbackResult {
  const [votes, setVotes] = useState<Record<string, FeedbackVote>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const submitFeedback = useCallback(
    async ({ eventId, vote, category, signalClass, signalScore }: {
      eventId: string;
      vote: FeedbackVote;
      category: EventCategory;
      signalClass: SignalClass;
      signalScore: number;
    }) => {
      setPending((prev) => ({ ...prev, [eventId]: true }));
      try {
        const response = await fetch(`${resolveApiBase()}/alerts/${encodeURIComponent(eventId)}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vote, category, signalClass, signalScore }),
        });
        if (!response.ok) throw new Error(`Failed to record feedback (${response.status})`);
        setVotes((prev) => ({ ...prev, [eventId]: vote }));
      } catch (err) {
        console.error("[feedback] failed to submit:", err);
      } finally {
        setPending((prev) => ({ ...prev, [eventId]: false }));
      }
    },
    [],
  );

  return {
    voteFor: (eventId) => votes[eventId],
    isSubmitting: (eventId) => pending[eventId] === true,
    submitFeedback,
  };
}
