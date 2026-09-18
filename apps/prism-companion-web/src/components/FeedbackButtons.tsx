// Thumbs up/down on a ContextCard's classification. Icon + text together
// (not icon-only), matching SignalBadge's convention (docs/ACCESSIBILITY.md:
// never convey meaning by an icon/color alone) -- and each button reports
// its pressed state via aria-pressed so a screen reader announces the
// current vote, not just a click target.

import { useAlertFeedback } from "../hooks/useAlertFeedback";
import type { EventCategory, SignalClass } from "prism-alert-engine";

export interface FeedbackButtonsProps {
  eventId: string;
  category: EventCategory;
  signalClass: SignalClass;
  signalScore: number;
}

export function FeedbackButtons({ eventId, category, signalClass, signalScore }: FeedbackButtonsProps) {
  const { voteFor, isSubmitting, submitFeedback } = useAlertFeedback();
  const vote = voteFor(eventId);
  const submitting = isSubmitting(eventId);

  return (
    <div className="feedback-buttons" role="group" aria-label="Was this alert helpful?">
      <button
        type="button"
        className="feedback-buttons__button"
        aria-pressed={vote === "up"}
        disabled={submitting}
        onClick={() => submitFeedback({ eventId, vote: "up", category, signalClass, signalScore })}
      >
        <span aria-hidden="true">👍</span> Helpful
      </button>
      <button
        type="button"
        className="feedback-buttons__button"
        aria-pressed={vote === "down"}
        disabled={submitting}
        onClick={() => submitFeedback({ eventId, vote: "down", category, signalClass, signalScore })}
      >
        <span aria-hidden="true">👎</span> Not helpful
      </button>
      <p className="feedback-buttons__status" role="status">
        {vote ? "Thanks -- feedback recorded." : ""}
      </p>
    </div>
  );
}
