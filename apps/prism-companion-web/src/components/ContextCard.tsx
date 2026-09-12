// Visual context card: renders buildContextCard()'s payload from
// prism-alert-engine. Semantic HTML and alt text from the start -- an <img>
// with a real alt description, a <time> element, and (for the newest card
// only) an aria-live region so screen readers announce new alerts as they
// arrive.

import type { ContextCardPayload } from "prism-alert-engine";
import { SignalBadge } from "./SignalBadge";

export interface ContextCardProps {
  card: ContextCardPayload;
  /** True for the newest card, so assistive tech announces it as it arrives. */
  live?: boolean;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ContextCard({ card, live = false }: ContextCardProps) {
  return (
    <article className="context-card" aria-live={live ? "assertive" : undefined} aria-atomic="true">
      <img className="context-card__snapshot" src={card.snapshotUrl} alt={card.description} />
      <div className="context-card__body">
        <SignalBadge signalClass={card.signalClass} />
        <p className="context-card__description">{card.description}</p>
        <time className="context-card__timestamp" dateTime={card.timestamp}>
          {formatTimestamp(card.timestamp)}
        </time>
      </div>
    </article>
  );
}
