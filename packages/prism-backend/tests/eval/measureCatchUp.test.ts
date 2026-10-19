import { describe, expect, it, vi } from "vitest";
import {
  CATCH_UP_CASES,
  checkAnswer,
  EVAL_ALERTS,
  evalDeps,
  inMemoryAlerts,
  LAST_LOOKED,
  NEW_ALERTS_HEADLINE,
  runCatchUpEval,
  summarize,
  type CatchUpCase,
} from "../../eval/measureCatchUp";
import { buildCatchUpTools } from "../../src/summary/catchUpAgent";

const ids = (alerts: { event: { id: string } }[]) => alerts.map((alert) => alert.event.id);
const caseById = (id: string): CatchUpCase => CATCH_UP_CASES.find((testCase) => testCase.id === id)!;

describe("the catch-up eval's household", () => {
  it("answers the alert store's queries in memory, most recent first", async () => {
    const listAlerts = inMemoryAlerts(EVAL_ALERTS);

    // Delivered since the household looked, including the 5:30 PM event delivered later.
    expect(ids(await listAlerts({ deliveredSince: LAST_LOOKED, limit: 50 }))).toEqual(["e8", "e7", "e6", "e5", "e4", "e3", "e9"]);
    // Happened in a window: Monday from noon to 6 PM Pacific.
    expect(
      ids(await listAlerts({ since: new Date("2026-10-19T19:00:00Z"), until: new Date("2026-10-20T01:00:00Z"), limit: 50 })),
    ).toEqual(["e9", "e2"]);
    expect(ids(await listAlerts({ signalClass: "Urgent", limit: 50 }))).toEqual(["e5"]);
    expect(ids(await listAlerts({ category: "package", limit: 50 }))).toEqual(["e8", "e2"]);
    expect(ids(await listAlerts({ limit: 2 }))).toEqual(["e8", "e7"]);
  });

  it("gives the agent's tools the headline the eval expects, and marks only the night alerts as during sleep hours", async () => {
    const tools = Object.fromEntries(buildCatchUpTools(evalDeps(), LAST_LOOKED).map((t) => [t.name, t]));
    const result = (await tools.list_new_alerts.invoke({})) as {
      headline: string;
      alerts: Array<{ time: string; duringSleepHours: boolean }>;
    };

    expect(result.headline).toBe(NEW_ALERTS_HEADLINE);
    expect(result.alerts.filter((alert) => alert.duringSleepHours).map((alert) => alert.time)).toEqual([
      "Tue, Oct 20, 3:10 AM",
      "Mon, Oct 19, 11:36 PM",
    ]);
  });
});

describe("checkAnswer", () => {
  it("passes an answer with every required fact and nothing ruled out", () => {
    const answer = `${NEW_ALERTS_HEADLINE} A person in a dark hoodie stood at the door at Mon, Oct 19, 11:36 PM. The person in a red jacket came again at 6:52 PM.`;
    expect(checkAnswer(answer, caseById("what-did-i-miss"))).toEqual({ factsOk: true, formatOk: true, failures: [] });
  });

  it("names each missing or ruled-out fact", () => {
    const answer = "Someone came at 11:36 PM and again at 6:40 PM.";
    expect(checkAnswer(answer, caseById("asleep")).failures).toEqual(["included: a visit outside the sleep hours"]);
    expect(checkAnswer("No packages came today.", caseById("package-today")).failures).toEqual([
      "missing: the envelope",
      "missing: at 8:20 AM",
    ]);
  });

  it("checks the format separately from the facts: under 80 words, no markdown, no emoji", () => {
    const testCase = caseById("worry");
    expect(checkAnswer(`${"word ".repeat(80)}11:36 PM`, testCase)).toMatchObject({ factsOk: true, formatOk: false });
    expect(checkAnswer("- **Urgent** at 11:36 PM", testCase).failures).toEqual(["format: markdown or a list"]);
    expect(checkAnswer("Urgent at 11:36 PM 🚨", testCase).failures).toEqual(["format: emoji"]);
  });
});

describe("runCatchUpEval", () => {
  it("asks every question each run, over the eval's household, and summarizes the checks", async () => {
    const answer = vi.fn(async (request: { question?: string }, deps: ReturnType<typeof evalDeps>) => {
      const alerts = await deps.listAlerts({ deliveredSince: LAST_LOOKED, limit: 50 });
      return request.question ? "I don't know." : `${NEW_ALERTS_HEADLINE} ${alerts.length} alerts. Urgent at 11:36 PM, then the same person came again.`;
    });

    const results = await runCatchUpEval(2, answer);
    const summary = summarize(results);

    expect(answer).toHaveBeenCalledTimes(2 * CATCH_UP_CASES.length);
    expect(answer).toHaveBeenCalledWith({ since: LAST_LOOKED }, expect.anything());
    expect(answer).toHaveBeenCalledWith({ since: LAST_LOOKED, question: "Did a package come today?" }, expect.anything());
    expect(summary.answers).toBe(2 * CATCH_UP_CASES.length);
    expect(summary.byCase["what-did-i-miss"]).toBe(2);
    expect(summary.byCase["package-today"]).toBe(0);
    expect(summary.formatCorrect).toBe(summary.answers);
  });
});
