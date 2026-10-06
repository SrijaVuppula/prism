// Evaluation harness for the Bedrock classification + orchestration
// pipeline. Runs every labeled event in dataset.ts through the real
// pipeline (classify -> score -> channel decision) and reports
// classification accuracy and end-to-end latency.
//
// This calls the live Bedrock endpoint -- it's a live evaluation, not a
// unit test -- so it needs valid AWS credentials, the same BEDROCK_REGION /
// BEDROCK_MODEL_ID env vars the backend uses (read from the environment or
// packages/prism-backend/.env), and a labeled fixture image for every entry
// in the dataset (see fixtures/README.md).
//
// Usage: npm run eval --workspace=prism-backend

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EventCategory, PrismEvent } from "prism-alert-engine";
import { runPipeline } from "../src/bedrock/agentOrchestration";
import { loadEnv } from "../src/loadEnv";
import { LABELED_EVENTS, type LabeledEvent } from "./dataset";

interface EvalOutcome {
  event: LabeledEvent;
  predictedCategory?: EventCategory;
  correct: boolean;
  latencyMs: number;
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function evaluateOne(labeled: LabeledEvent): Promise<EvalOutcome> {
  const fixturePath = fileURLToPath(labeled.snapshotUrl);
  if (!existsSync(fixturePath)) {
    return {
      event: labeled,
      correct: false,
      latencyMs: 0,
      error: `Missing fixture image: ${fixturePath} (see fixtures/README.md)`,
    };
  }

  const syntheticEvent: PrismEvent = {
    id: labeled.id,
    occurredAt: new Date().toISOString(),
    snapshotUrl: labeled.snapshotUrl,
  };

  const startedAt = Date.now();
  try {
    const result = await runPipeline(syntheticEvent);
    const latencyMs = Date.now() - startedAt;
    const predictedCategory = result.event.classification?.category;
    return {
      event: labeled,
      predictedCategory,
      correct: predictedCategory === labeled.expectedCategory,
      latencyMs,
    };
  } catch (err) {
    return {
      event: labeled,
      correct: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printReport(outcomes: EvalOutcome[]): void {
  const byCategory = new Map<EventCategory, { total: number; correct: number }>();
  const latencies: number[] = [];
  let correctCount = 0;
  let errorCount = 0;

  for (const outcome of outcomes) {
    const bucket = byCategory.get(outcome.event.expectedCategory) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (outcome.correct) bucket.correct += 1;
    byCategory.set(outcome.event.expectedCategory, bucket);

    if (outcome.correct) correctCount += 1;
    if (outcome.error) errorCount += 1;
    if (!outcome.error) latencies.push(outcome.latencyMs);
  }

  console.log("\n=== Classification accuracy ===");
  for (const [category, { total, correct }] of byCategory) {
    console.log(`  ${category.padEnd(8)} ${correct}/${total} (${((correct / total) * 100).toFixed(0)}%)`);
  }
  console.log(`  overall  ${correctCount}/${outcomes.length} (${((correctCount / outcomes.length) * 100).toFixed(0)}%)`);
  if (errorCount > 0) {
    console.log(`  ${errorCount} event(s) errored (missing fixtures or pipeline failures) -- excluded from latency stats`);
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  console.log("\n=== End-to-end latency (event -> classification -> score -> channel decision) ===");
  if (sorted.length === 0) {
    console.log("  no successful runs to measure");
  } else {
    const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
    console.log(
      `  mean ${mean.toFixed(0)}ms  p50 ${percentile(sorted, 50)}ms  p95 ${percentile(sorted, 95)}ms  max ${sorted[sorted.length - 1]}ms`,
    );
  }

  console.log("\n=== Misclassifications ===");
  const misses = outcomes.filter((o) => !o.correct);
  if (misses.length === 0) {
    console.log("  none");
  } else {
    for (const miss of misses) {
      const detail = miss.error ?? `predicted ${miss.predictedCategory ?? "?"}`;
      console.log(`  ${miss.event.id}: expected ${miss.event.expectedCategory}, got ${detail}`);
    }
  }
  console.log();
}

async function main() {
  loadEnv();
  console.log(`Running ${LABELED_EVENTS.length} labeled events against the live classification pipeline...`);
  // Sequential, not parallel: keeps this well under Bedrock's per-account
  // rate limits without needing a separate throttling layer.
  const outcomes: EvalOutcome[] = [];
  for (const labeled of LABELED_EVENTS) {
    outcomes.push(await evaluateOne(labeled));
  }
  printReport(outcomes);
}

main().catch((err) => {
  console.error("Evaluation run failed:", err);
  process.exitCode = 1;
});
