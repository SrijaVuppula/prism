// Visual context card: renders buildContextCard()'s payload from
// prism-alert-engine. Semantic HTML and alt text from the start -- an <img>
// with a real alt description, a <time> element, and (for the newest card
// only) an aria-live region so screen readers announce new alerts as they
// arrive.
//
// Also the natural home for two personalization touchpoints: thumbs
// up/down feedback on the classification (FeedbackButtons, feeding the
// scoring feedback loop) and the opt-in "tag this visitor" control
// (TagVisitorControl, shown only when the household has turned on
// known-visitor tagging in Settings and repeat-visitor memory has grouped
// this event under a visitorGroupId).

import type { ContextCardPayload, PrismEvent } from "prism-alert-engine";
import { SignalBadge } from "./SignalBadge";
import { FeedbackButtons } from "./FeedbackButtons";
import { TagVisitorControl } from "./TagVisitorControl";

export interface ContextCardProps {
  card: ContextCardPayload;
  /** Full event this card was built from -- carries classification/scoring/visitorGroupId that the card payload itself doesn't. */
  event: PrismEvent;
  /** True for the newest card, so assistive tech announces it as it arrives. */
  live?: boolean;
  /** Whether the household has opted into known-visitor tagging (see docs/ACCESSIBILITY.md's privacy note). */
  knownVisitorTaggingEnabled?: boolean;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ContextCard({ card, event, live = false, knownVisitorTaggingEnabled = false }: ContextCardProps) {
  return (
    <article className="context-card" aria-live={live ? "assertive" : undefined} aria-atomic="true">
      <img className="context-card__snapshot" src={card.snapshotUrl} alt={card.description} />
      <div className="context-card__body">
        <SignalBadge signalClass={card.signalClass} />
        <p className="context-card__description">{card.description}</p>
        <time className="context-card__timestamp" dateTime={card.timestamp}>
          {formatTimestamp(card.timestamp)}
        </time>

        {event.classification && event.scoring && (
          <FeedbackButtons
            eventId={event.id}
            category={event.classification.category}
            signalClass={event.scoring.signalClass}
            signalScore={event.scoring.signalScore}
          />
        )}

        {knownVisitorTaggingEnabled && event.visitorGroupId && (
          <TagVisitorControl visitorGroupId={event.visitorGroupId} />
        )}
      </div>
    </article>
  );
}
