// "Why this score": every factor that moved the Signal Score, with its
// signed contribution -- the explainable breakdown prism-alert-engine
// returns, in plain language.

import type { ClassificationResult, ScoringResult } from "prism-alert-engine";
import { formatContribution, scoreFactors } from "../lib/scoreFactors";

export interface ScoreBreakdownProps {
  scoring: ScoringResult;
  classification?: ClassificationResult;
}

export function ScoreBreakdown({ scoring, classification }: ScoreBreakdownProps) {
  const factors = scoreFactors(scoring, classification);
  return (
    <section className="score-breakdown" aria-label="Why this score">
      <h3 className="panel-label">Why this score</h3>
      <dl className="score-breakdown__list">
        {factors.map((factor) => (
          <div
            key={factor.key}
            className={`score-breakdown__row${factor.value < 0 ? " score-breakdown__row--negative" : ""}`}
          >
            <dt>{factor.label}</dt>
            <dd>{formatContribution(factor.value)}</dd>
          </div>
        ))}
        <div className="score-breakdown__row score-breakdown__row--total">
          <dt>Signal Score</dt>
          <dd>{scoring.signalScore}</dd>
        </div>
      </dl>
    </section>
  );
}
