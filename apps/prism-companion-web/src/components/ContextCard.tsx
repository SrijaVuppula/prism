// Visual context card: renders buildContextCard()'s payload from
// prism-alert-engine. Semantic HTML and alt text from the start -- an <img>
// with a real alt description, a <time> element, and (for the newest card
// only) an aria-live region so screen readers announce new alerts as they
// arrive. The live card is kept to what an announcement needs (class,
// subject, description, time); the score breakdown and delivery details sit
// beside it in AlertDetails so they don't make every announcement longer.
//
// The snapshot is loaded through the backend (GET /events/:id/snapshot)
// rather than from card.snapshotUrl, which may be a local file:// URL or
// need credentials the browser doesn't have. If it still fails to load,
// the image is dropped instead of leaving a broken-image icon behind.
//
// Also the natural home for two personalization touchpoints: thumbs
// up/down feedback on the classification (FeedbackButtons, feeding the
// scoring feedback loop) and the opt-in "tag this visitor" control
// (TagVisitorControl, shown only when the household has turned on
// known-visitor tagging in Settings and repeat-visitor memory has grouped
// this event under a visitorGroupId).

import { useState } from "react";
import type { ContextCardPayload, PrismEvent } from "prism-alert-engine";
import { resolveApiBase } from "../lib/apiBase";
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
  /** "hero" for the latest alert, "compact" for the history list. */
  variant?: "hero" | "compact";
  /** Household time zone (IANA name) for the timestamp; defaults to this device's zone. */
  timeZone?: string;
  /** Name of the camera or doorbell the event came from, e.g. "Front Door". */
  deviceName?: string;
}

const CATEGORY_NOUNS: Record<string, string> = {
  person: "Person",
  package: "Package",
  vehicle: "Vehicle",
  animal: "Animal",
};

/** "Oct 6, 2026, 4:02 PM EDT" -- in the household's time zone when one is given. */
export function formatTimestamp(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return date.toLocaleString(undefined, { ...options, timeZone });
  } catch {
    // An unrecognized zone name: fall back to this device's own zone.
    return date.toLocaleString(undefined, options);
  }
}

export function snapshotSrc(eventId: string): string {
  return `${resolveApiBase()}/events/${encodeURIComponent(eventId)}/snapshot`;
}

export function ContextCard({
  card,
  event,
  live = false,
  knownVisitorTaggingEnabled = false,
  variant = "hero",
  timeZone,
  deviceName,
}: ContextCardProps) {
  // Keyed by event id: the live card is reused for each new alert, so a
  // failure on one snapshot mustn't hide the next one.
  const [failedSnapshotId, setFailedSnapshotId] = useState<string | null>(null);
  const snapshotFailed = failedSnapshotId === event.id;
  const classification = event.classification;
  const subjectParts = [
    deviceName,
    classification &&
      `${CATEGORY_NOUNS[classification.category] ?? classification.category} · ${Math.round(classification.confidence * 100)}% confidence`,
  ].filter(Boolean);
  const subject = subjectParts.length > 0 ? subjectParts.join(" · ") : null;

  return (
    <article
      className={`context-card context-card--${variant} context-card--${card.signalClass.toLowerCase()}`}
      aria-live={live ? "assertive" : undefined}
      aria-atomic="true"
    >
      {!snapshotFailed && (
        <div className="context-card__media">
          <img
            className="context-card__snapshot"
            src={snapshotSrc(event.id)}
            alt={card.description}
            onError={() => setFailedSnapshotId(event.id)}
          />
        </div>
      )}
      <div className="context-card__body">
        <div className="context-card__meta">
          <SignalBadge signalClass={card.signalClass} />
          <time className="context-card__timestamp" dateTime={card.timestamp}>
            {formatTimestamp(card.timestamp, timeZone)}
          </time>
        </div>
        {subject && <p className="context-card__subject">{subject}</p>}
        <p className="context-card__description">{card.description}</p>
        {variant === "compact" && event.scoring && (
          <p className="context-card__score">Signal Score {event.scoring.signalScore}</p>
        )}

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
