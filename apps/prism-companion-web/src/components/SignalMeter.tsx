// Signal Score as a number plus a 0-100 meter with the Routine / Notable /
// Urgent bands marked, so the class boundaries are visible rather than
// implied. Exposed to assistive tech as a native ARIA meter with the
// class spelled out in its value text.

import type { SignalClass } from "prism-alert-engine";

// Mirrors NOTABLE_THRESHOLD / URGENT_THRESHOLD in prism-alert-engine's scoring.ts.
const NOTABLE_FROM = 35;
const URGENT_FROM = 70;

const BANDS = [
  { name: "routine", from: 0, to: NOTABLE_FROM },
  { name: "notable", from: NOTABLE_FROM, to: URGENT_FROM },
  { name: "urgent", from: URGENT_FROM, to: 100 },
];

/** How much of a band (0-100%) the score has filled. */
function bandFill(score: number, band: { from: number; to: number }): number {
  return Math.max(0, Math.min(1, (score - band.from) / (band.to - band.from))) * 100;
}

export interface SignalMeterProps {
  score: number;
  signalClass: SignalClass;
}

export function SignalMeter({ score, signalClass }: SignalMeterProps) {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className={`signal-meter signal-meter--${signalClass.toLowerCase()}`}>
      <div className="signal-meter__header">
        <span className="signal-meter__label">Signal Score</span>
        <span className="signal-meter__value">
          {clamped}
          <span className="signal-meter__max">/100</span>
        </span>
      </div>
      <div
        className="signal-meter__track"
        role="meter"
        aria-label="Signal Score"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} out of 100, ${signalClass}`}
      >
        {BANDS.map((band) => (
          <span
            key={band.name}
            className={`signal-meter__band signal-meter__band--${band.name}`}
            style={{ flexGrow: band.to - band.from }}
          >
            <span className="signal-meter__band-fill" style={{ width: `${bandFill(clamped, band)}%` }} />
          </span>
        ))}
        <span className="signal-meter__marker" style={{ left: `${clamped}%` }} />
      </div>
      <div className="signal-meter__scale" aria-hidden="true">
        <span style={{ left: "0%" }}>Routine</span>
        <span style={{ left: `${NOTABLE_FROM}%` }}>Notable</span>
        <span style={{ left: `${URGENT_FROM}%` }}>Urgent</span>
      </div>
    </div>
  );
}
