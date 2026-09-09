// Web Vibration API pattern encoder — one distinct pattern per Signal Class.
// Keep this table in sync with docs/ACCESSIBILITY.md.

import { SignalClass } from "../types";

const PATTERNS: Record<SignalClass, number[]> = {
  Routine: [100],
  Notable: [150, 100, 150],
  Urgent: [300, 150, 300, 150, 300],
};

export function encodeHapticPattern(signalClass: SignalClass): number[] {
  return PATTERNS[signalClass];
}
