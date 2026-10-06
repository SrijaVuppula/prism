// Plain-language labels for the Signal Score breakdown that
// prism-alert-engine's computeSignalScore() returns, so the card can show
// why an alert scored the way it did. Factor keys mirror scoring.ts; an
// unknown key is still shown, under its raw name, rather than dropped.

import type { ClassificationResult, ScoringResult } from "prism-alert-engine";

export interface ScoreFactor {
  key: string;
  label: string;
  value: number;
}

const CATEGORY_NOUNS: Record<string, string> = {
  person: "Person",
  package: "Package",
  vehicle: "Vehicle",
  animal: "Animal",
};

function labelFor(key: string, classification?: ClassificationResult): string {
  switch (key) {
    case "categoryBase":
      return `${CATEGORY_NOUNS[classification?.category ?? ""] ?? "Subject"} detected`;
    case "confidenceAdjustment":
      return classification
        ? `Model confidence (${Math.round(classification.confidence * 100)}%)`
        : "Model confidence";
    case "timeOfDay":
      return "Late night or early morning";
    case "knownVisitor":
      return "Known visitor";
    case "repeatVisit":
      return "Repeat visit";
    case "quietHours":
      return "Quiet hours";
    case "feedbackAdjustment":
      return "Your feedback";
    default:
      return key;
  }
}

/**
 * The factors that moved this score, in the order scoring.ts applies them.
 * The category base is always included; other factors only when non-zero.
 */
export function scoreFactors(scoring: ScoringResult, classification?: ClassificationResult): ScoreFactor[] {
  return Object.entries(scoring.breakdown)
    .filter(([key, value]) => key === "categoryBase" || value !== 0)
    .map(([key, value]) => ({ key, label: labelFor(key, classification), value }));
}

/** "+15", "−8" (true minus sign), "0". */
export function formatContribution(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}
