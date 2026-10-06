// Which channels an alert went out on: the visual card, a vibration, and a
// Web Push notification. State is carried by text (and an icon), not by
// color alone.

import type { ChannelPayloads } from "../types";

const CHANNELS: Array<{ key: keyof ChannelPayloads; label: string }> = [
  { key: "visual", label: "Card" },
  { key: "haptic", label: "Vibration" },
  { key: "push", label: "Push" },
];

export function DeliveryChannels({ channels }: { channels: ChannelPayloads }) {
  return (
    <section className="delivery" aria-label="Delivered as">
      <h3 className="panel-label">Delivered as</h3>
      <ul className="delivery__list">
        {CHANNELS.map(({ key, label }) => {
          const sent = channels[key] !== undefined;
          return (
            <li key={key} className={`delivery__item delivery__item--${sent ? "sent" : "skipped"}`}>
              <span aria-hidden="true">{sent ? "✓" : "–"}</span>
              {label}
              <span className="visually-hidden">{sent ? ": sent" : ": not sent"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
