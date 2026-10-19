// Measures how accurately the catch-up agent ("What did I miss?") answers,
// with live Bedrock calls, against a fixed household day with known answers.
//
// The household is in Los Angeles with quiet hours from 10 PM to 7 AM. It
// last looked at its alerts at 6 PM on Monday, and it's now 9 AM on Tuesday.
// Nine alerts cover the two days, including a repeat visit, an Urgent visit
// at night, an animal overnight, and an event that happened before 6 PM but
// was only delivered after it (as when Prism finds a missed event in Ring's
// event history). Each question lists facts the answer must contain and
// facts it must not, such as an event outside the window asked about.
//
// Every answer is also checked against the format the agent is told to use:
// under 80 words, plain sentences, no markdown or emoji.
//
// Usage: npm run eval:catch-up --workspace=prism-backend
// (live Bedrock: each question is asked CATCH_UP_EVAL_RUNS times, default 3,
// and each answer takes a few model calls)

import type { CompanionEventMessage } from "../src/api/websocket";
import type { AlertQuery } from "../src/db/alertHistoryStore";
import { loadEnv } from "../src/loadEnv";
import { DEFAULT_PREFERENCES, type UserPreferences } from "../src/preferences/preferencesStore";
import { answerCatchUp, type CatchUpDeps, type CatchUpRequest } from "../src/summary/catchUpAgent";

export const NOW = new Date("2026-10-20T16:00:00Z"); // Tue 9:00 AM PDT
export const LAST_LOOKED = new Date("2026-10-20T01:00:00Z"); // Mon 6:00 PM PDT

export const HOUSEHOLD: UserPreferences = {
  ...DEFAULT_PREFERENCES,
  timeZone: "America/Los_Angeles",
  quietHours: { enabled: true, startHour: 22, endHour: 7 },
};

export interface StoredAlert {
  message: CompanionEventMessage;
  deliveredAt: Date;
}

const SCORES = { Urgent: 82, Notable: 55, Routine: 20 } as const;

function stored(
  id: string,
  occurredAt: string,
  signalClass: keyof typeof SCORES,
  category: "person" | "package" | "vehicle" | "animal",
  description: string,
  options: { deliveredAt?: string; repeatVisit?: boolean } = {},
): StoredAlert {
  return {
    message: {
      type: "prism-event",
      event: {
        id,
        occurredAt,
        snapshotUrl: `ring://devices/front/snapshot?at=${Date.parse(occurredAt)}`,
        classification: { category, description, confidence: 0.9 },
        scoring: {
          signalScore: SCORES[signalClass],
          signalClass,
          breakdown: options.repeatVisit ? { repeatVisit: -8 } : {},
        },
      },
      channels: {},
      device: { id: "front", name: "Front Door" },
    },
    deliveredAt: new Date(options.deliveredAt ?? occurredAt),
  };
}

// Times in the comments are Pacific Daylight Time.
export const EVAL_ALERTS: StoredAlert[] = [
  stored("e1", "2026-10-19T17:15:00Z", "Routine", "animal", "A cat walked across the porch."), // Mon 10:15 AM
  stored("e2", "2026-10-19T21:30:00Z", "Notable", "package", "A delivery driver left a brown box on the doormat."), // Mon 2:30 PM
  // Mon 5:30 PM, before the household last looked, but only delivered at 7 PM.
  stored("e9", "2026-10-20T00:30:00Z", "Routine", "vehicle", "A car pulled into the driveway and left.", {
    deliveredAt: "2026-10-20T02:00:00Z",
  }),
  stored("e3", "2026-10-20T01:40:00Z", "Notable", "person", "A person in a red jacket rang the doorbell."), // Mon 6:40 PM
  stored("e4", "2026-10-20T01:52:00Z", "Notable", "person", "A person in a red jacket at the door.", {
    repeatVisit: true,
  }), // Mon 6:52 PM
  stored("e5", "2026-10-20T06:36:00Z", "Urgent", "person", "A person in a dark hoodie standing at the door."), // Mon 11:36 PM
  stored("e6", "2026-10-20T10:10:00Z", "Routine", "animal", "A raccoon on the porch steps."), // Tue 3:10 AM
  stored("e7", "2026-10-20T14:45:00Z", "Notable", "vehicle", "A white van parked in the driveway."), // Tue 7:45 AM
  stored("e8", "2026-10-20T15:20:00Z", "Notable", "package", "A small envelope was left by the door."), // Tue 8:20 AM
];

/** The alert history store's query, over `alerts` in memory: most recent first. */
export function inMemoryAlerts(alerts: StoredAlert[]): CatchUpDeps["listAlerts"] {
  return async (query: AlertQuery) =>
    alerts
      .filter(({ message, deliveredAt }) => {
        const occurredAt = new Date(message.event.occurredAt);
        if (query.since && occurredAt < query.since) return false;
        if (query.until && occurredAt >= query.until) return false;
        if (query.deliveredSince && deliveredAt < query.deliveredSince) return false;
        if (query.signalClass && message.event.scoring?.signalClass !== query.signalClass) return false;
        if (query.category && message.event.classification?.category !== query.category) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.message.event.occurredAt) - Date.parse(a.message.event.occurredAt))
      .slice(0, query.limit)
      .map(({ message }) => message);
}

export function evalDeps(): CatchUpDeps {
  return { listAlerts: inMemoryAlerts(EVAL_ALERTS), getPreferences: async () => HOUSEHOLD, now: () => NOW };
}

export interface Check {
  /** What the check means, shown when it fails. */
  label: string;
  pattern: RegExp;
}

export interface CatchUpCase {
  id: string;
  /** Omitted for the "What did I miss?" button. */
  question?: string;
  mustInclude: Check[];
  mustNotInclude: Check[];
}

const at = (time: string): RegExp => new RegExp(time.replace(" ", "\\s*"), "i");

/** list_new_alerts' headline for the seven alerts delivered since Monday 6 PM, which the answer must start with. */
export const NEW_ALERTS_HEADLINE = "You have 7 new alerts: 1 Urgent, 4 Notable and 2 Routine.";

export const CATCH_UP_CASES: CatchUpCase[] = [
  {
    id: "what-did-i-miss",
    mustInclude: [
      { label: "starts with the headline, word for word", pattern: new RegExp(`^${NEW_ALERTS_HEADLINE.replace(/\./g, "\\.")}`) },
      { label: "the Urgent visit at 11:36 PM", pattern: at("11:36 PM") },
      { label: "says the person came again", pattern: /again|same (person|visitor)|came back|returned/i },
    ],
    mustNotInclude: [
      { label: "Monday morning's cat, from before the household looked", pattern: /\bcat\b/i },
      { label: "Monday's 2:30 PM package, from before the household looked", pattern: at("2:30 PM") },
    ],
  },
  {
    id: "asleep",
    question: "Did anyone come while I was asleep?",
    mustInclude: [{ label: "the person at 11:36 PM", pattern: at("11:36 PM") }],
    mustNotInclude: [
      { label: "a visit outside the sleep hours", pattern: /6:40|6:52|7:45|8:20|5:30/ },
    ],
  },
  {
    id: "package-today",
    question: "Did a package come today?",
    mustInclude: [
      { label: "the envelope", pattern: /envelope/i },
      { label: "at 8:20 AM", pattern: at("8:20 AM") },
    ],
    mustNotInclude: [{ label: "yesterday's box", pattern: /brown box|2:30/i }],
  },
  {
    id: "urgent-count",
    question: "How many Urgent alerts came in since I last checked?",
    mustInclude: [{ label: "one", pattern: /\b(one|1)\b/i }],
    mustNotInclude: [{ label: "a wrong count", pattern: /\b(two|three|four|2|3|4) urgent/i }],
  },
  {
    id: "vehicle-this-morning",
    question: "Was there a vehicle in the driveway this morning?",
    mustInclude: [
      { label: "the van", pattern: /\bvan\b/i },
      { label: "at 7:45 AM", pattern: at("7:45 AM") },
    ],
    mustNotInclude: [{ label: "yesterday's car at 5:30 PM", pattern: /5:30/ }],
  },
  {
    id: "same-person",
    question: "Did the same person come back?",
    mustInclude: [
      { label: "says they came back", pattern: /\byes\b|again|came back|returned/i },
      { label: "the repeat visit at 6:52 PM", pattern: at("6:52 PM") },
    ],
    mustNotInclude: [],
  },
  {
    id: "worry",
    question: "Is there anything I should worry about?",
    mustInclude: [{ label: "the Urgent visit at 11:36 PM", pattern: at("11:36 PM") }],
    mustNotInclude: [],
  },
  {
    id: "animals-overnight",
    question: "Were there any animals overnight?",
    mustInclude: [
      { label: "the raccoon", pattern: /raccoon/i },
      { label: "at 3:10 AM", pattern: at("3:10 AM") },
    ],
    mustNotInclude: [{ label: "Monday morning's cat", pattern: /\bcat\b/i }],
  },
  {
    id: "yesterday-afternoon",
    question: "What happened yesterday afternoon?",
    // The car at 5:30 PM may or may not count as afternoon, so it's neither required nor ruled out.
    mustInclude: [{ label: "the package at 2:30 PM", pattern: at("2:30 PM") }],
    mustNotInclude: [{ label: "an event outside the afternoon", pattern: /11:36|10:15|6:40|6:52/ }],
  },
  {
    id: "no-match",
    question: "Did a vehicle come overnight?",
    mustInclude: [{ label: "says there wasn't one", pattern: /\b(no|none|not|didn't|did not|wasn't|were no)\b/i }],
    mustNotInclude: [{ label: "a vehicle from outside the night", pattern: /7:45|5:30/ }],
  },
];

export const MAX_WORDS = 80;

export interface CheckedAnswer {
  factsOk: boolean;
  formatOk: boolean;
  failures: string[];
}

/** Checks one answer against its case's facts and the agent's format rules. */
export function checkAnswer(answer: string, testCase: CatchUpCase): CheckedAnswer {
  const factFailures = [
    ...testCase.mustInclude.filter((check) => !check.pattern.test(answer)).map((check) => `missing: ${check.label}`),
    ...testCase.mustNotInclude.filter((check) => check.pattern.test(answer)).map((check) => `included: ${check.label}`),
  ];
  const formatFailures: string[] = [];
  const words = answer.split(/\s+/).filter(Boolean).length;
  if (words >= MAX_WORDS) formatFailures.push(`format: ${words} words, not under ${MAX_WORDS}`);
  if (/[*#`|]|^\s*([-•]|\d+\.)\s/m.test(answer)) formatFailures.push("format: markdown or a list");
  if (/\p{Extended_Pictographic}/u.test(answer)) formatFailures.push("format: emoji");
  return {
    factsOk: factFailures.length === 0,
    formatOk: formatFailures.length === 0,
    failures: [...factFailures, ...formatFailures],
  };
}

export interface CaseResult extends CheckedAnswer {
  id: string;
  run: number;
  answer: string;
  latencyMs: number;
}

export type Answerer = (request: CatchUpRequest, deps: CatchUpDeps) => Promise<string>;

/** Asks every question `runs` times, one at a time, and checks each answer. */
export async function runCatchUpEval(runs: number, answer: Answerer = (request, deps) => answerCatchUp(request, deps)) {
  const results: CaseResult[] = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const testCase of CATCH_UP_CASES) {
      const request: CatchUpRequest = { since: LAST_LOOKED, ...(testCase.question ? { question: testCase.question } : {}) };
      const startedAt = Date.now();
      const text = await answer(request, evalDeps());
      results.push({ id: testCase.id, run, answer: text, latencyMs: Date.now() - startedAt, ...checkAnswer(text, testCase) });
    }
  }
  return results;
}

export interface Summary {
  answers: number;
  factsCorrect: number;
  formatCorrect: number;
  bothCorrect: number;
  /** For each question: answers with the facts right, out of `runs`. */
  byCase: Record<string, number>;
}

export function summarize(results: CaseResult[]): Summary {
  const byCase: Record<string, number> = {};
  for (const result of results) byCase[result.id] = (byCase[result.id] ?? 0) + (result.factsOk ? 1 : 0);
  return {
    answers: results.length,
    factsCorrect: results.filter((result) => result.factsOk).length,
    formatCorrect: results.filter((result) => result.formatOk).length,
    bothCorrect: results.filter((result) => result.factsOk && result.formatOk).length,
    byCase,
  };
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const pct = (part: number, whole: number) => `${part}/${whole} (${Math.round((100 * part) / whole)}%)`;

async function main() {
  loadEnv();
  const runs = Number(process.env.CATCH_UP_EVAL_RUNS ?? 3);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("CATCH_UP_EVAL_RUNS must be a whole number of at least 1");
  console.log(`Asking ${CATCH_UP_CASES.length} questions ${runs} time(s) each (live Bedrock)...\n`);

  const results = await runCatchUpEval(runs);
  for (const result of results) {
    const ok = result.factsOk && result.formatOk;
    console.log(`[${ok ? "pass" : "FAIL"}] run ${result.run} ${result.id} (${(result.latencyMs / 1000).toFixed(1)} s)`);
    console.log(`  ${result.answer.replace(/\n+/g, " ")}`);
    for (const failure of result.failures) console.log(`  - ${failure}`);
  }

  const summary = summarize(results);
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const mean = Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length);
  console.log("\nFacts right, by question:");
  for (const testCase of CATCH_UP_CASES) console.log(`  ${testCase.id}: ${summary.byCase[testCase.id]}/${runs}`);
  console.log(`\nFacts right:       ${pct(summary.factsCorrect, summary.answers)}`);
  console.log(`Format right:      ${pct(summary.formatCorrect, summary.answers)}`);
  console.log(`Both right:        ${pct(summary.bothCorrect, summary.answers)}`);
  console.log(`Latency: mean ${mean} ms, p50 ${percentile(latencies, 50)} ms, p95 ${percentile(latencies, 95)} ms, max ${latencies[latencies.length - 1]} ms`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
