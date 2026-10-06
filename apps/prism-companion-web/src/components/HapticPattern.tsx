// Draws the vibration pattern an alert was delivered with -- pulses as
// bars, pauses as gaps, widths to scale -- so the haptic channel is visible
// too, including on devices with no Vibration API (iOS Safari).

import type { SignalClass } from "prism-alert-engine";

export interface HapticPatternProps {
  /** Alternating on/off durations in ms, as passed to navigator.vibrate(). */
  pattern?: number[];
  signalClass: SignalClass;
}

function describe(pattern: number[]): string {
  const pulses = pattern.filter((_, i) => i % 2 === 0);
  const total = pattern.reduce((sum, ms) => sum + ms, 0);
  const allSame = pulses.every((ms) => ms === pulses[0]);
  const pulseText = allSame
    ? `${pulses.length} ${pulses.length === 1 ? "pulse" : "pulses"} of ${pulses[0]} ms`
    : `${pulses.length} pulses (${pulses.join(", ")} ms)`;
  return `${pulseText}, ${(total / 1000).toFixed(1)} s in total`;
}

export function HapticPattern({ pattern, signalClass }: HapticPatternProps) {
  const hasPattern = pattern !== undefined && pattern.length > 0;
  return (
    <section className="haptic-pattern" aria-label="Vibration">
      <h3 className="panel-label">Vibration</h3>
      {hasPattern ? (
        <>
          <div
            className={`haptic-pattern__bars haptic-pattern__bars--${signalClass.toLowerCase()}`}
            role="img"
            aria-label={`Vibration pattern: ${describe(pattern)}`}
          >
            {pattern.map((ms, i) => (
              <span
                key={i}
                className={i % 2 === 0 ? "haptic-pattern__pulse" : "haptic-pattern__pause"}
                style={{ flexGrow: ms }}
              />
            ))}
          </div>
          <p className="haptic-pattern__caption" aria-hidden="true">
            {describe(pattern)}
          </p>
        </>
      ) : (
        <p className="haptic-pattern__caption">None. {signalClass} alerts are visual only.</p>
      )}
    </section>
  );
}
