// Signal Class indicator. Icon + text together, deliberately -- Signal
// Class must never be conveyed by color alone (docs/ACCESSIBILITY.md).

import type { SignalClass } from "prism-alert-engine";

const SIGNAL_CLASS_META: Record<SignalClass, { icon: string; className: string }> = {
  Routine: { icon: "●", className: "signal-badge--routine" },
  Notable: { icon: "▲", className: "signal-badge--notable" },
  Urgent: { icon: "■", className: "signal-badge--urgent" },
};

export interface SignalBadgeProps {
  signalClass: SignalClass;
}

export function SignalBadge({ signalClass }: SignalBadgeProps) {
  const meta = SIGNAL_CLASS_META[signalClass];
  return (
    <span className={`signal-badge ${meta.className}`}>
      <span aria-hidden="true">{meta.icon}</span>
      {signalClass}
    </span>
  );
}
