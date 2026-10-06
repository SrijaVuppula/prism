// Counts of the alerts currently shown, by Signal Class -- a glanceable
// read on how busy the door has been.

import type { SignalClass } from "prism-alert-engine";
import type { CompanionEventMessage } from "../types";

const CLASSES: Array<{ signalClass: SignalClass; icon: string }> = [
  { signalClass: "Urgent", icon: "■" },
  { signalClass: "Notable", icon: "▲" },
  { signalClass: "Routine", icon: "●" },
];

export function AlertSummary({ events }: { events: CompanionEventMessage[] }) {
  const counts = new Map<SignalClass, number>();
  for (const message of events) {
    const signalClass = message.channels.visual?.signalClass;
    if (signalClass) counts.set(signalClass, (counts.get(signalClass) ?? 0) + 1);
  }

  return (
    <section className="alert-summary" aria-label="Alert summary">
      <h2 className="section-title">Recent activity</h2>
      <ul className="alert-summary__list">
        {CLASSES.map(({ signalClass, icon }) => (
          <li key={signalClass} className={`alert-summary__item alert-summary__item--${signalClass.toLowerCase()}`}>
            <span className="alert-summary__count">{counts.get(signalClass) ?? 0}</span>
            <span className="alert-summary__label">
              <span aria-hidden="true">{icon}</span> {signalClass}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
