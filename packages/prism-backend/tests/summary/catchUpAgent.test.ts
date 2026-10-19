import { Model, type Message } from "@strands-agents/sdk";
import { describe, expect, it, vi } from "vitest";
import type { CompanionEventMessage } from "../../src/api/websocket";
import {
  alertTime,
  answerCatchUp,
  buildCatchUpTools,
  catchUpPrompt,
  lastLookedAt,
  MAX_ANSWER_WORDS,
  newAlertsHeadline,
  SYSTEM_PROMPT,
  wordCount,
  type CatchUpDeps,
} from "../../src/summary/catchUpAgent";
import { DEFAULT_PREFERENCES } from "../../src/preferences/preferencesStore";

const NOW = new Date("2026-10-14T15:00:00Z");
const LAST_LOOKED = new Date("2026-10-14T05:00:00Z");

function alert(
  id: string,
  occurredAt: string,
  signalClass: "Urgent" | "Notable" | "Routine",
  category: "person" | "package" | "vehicle" | "animal",
  description: string,
  breakdown: Record<string, number> = {},
): CompanionEventMessage {
  return {
    type: "prism-event",
    event: {
      id,
      occurredAt,
      snapshotUrl: `ring://devices/dev/snapshot?at=${Date.parse(occurredAt)}`,
      classification: { category, description, confidence: 0.9 },
      scoring: { signalScore: signalClass === "Urgent" ? 82 : signalClass === "Notable" ? 50 : 20, signalClass, breakdown },
    },
    channels: {},
    device: { id: "dev", name: "Front Door" },
  };
}

const ALERTS = [
  alert("a3", "2026-10-14T20:05:00Z", "Notable", "package", "A brown box was left on the doormat."),
  alert("a2", "2026-10-14T09:40:00Z", "Urgent", "person", "A person in a dark hoodie at the door.", { repeatVisit: -8 }),
  alert("a1", "2026-10-14T08:10:00Z", "Routine", "animal", "A cat walked across the porch."),
];

function deps(overrides: Partial<CatchUpDeps> = {}): CatchUpDeps & { listAlerts: ReturnType<typeof vi.fn> } {
  return {
    listAlerts: vi.fn().mockResolvedValue(ALERTS),
    getPreferences: vi.fn().mockResolvedValue({
      ...DEFAULT_PREFERENCES,
      timeZone: "America/Los_Angeles",
      quietHours: { enabled: true, startHour: 22, endHour: 7 },
    }),
    now: () => NOW,
    ...overrides,
  } as never;
}

function toolsByName(d: CatchUpDeps) {
  return Object.fromEntries(buildCatchUpTools(d, LAST_LOOKED).map((t) => [t.name, t]));
}

describe("catch-up tools", () => {
  it("get_current_time gives the local time and sleep hours: the quiet hours, or 10 PM to 7 AM", async () => {
    const result = await toolsByName(deps()).get_current_time.invoke({});
    expect(result).toEqual({
      now: "2026-10-14T15:00:00.000Z",
      localTime: "Wed, Oct 14, 8:00 AM",
      timeZone: "America/Los_Angeles",
      sleepHours: { from: "10 PM", to: "7 AM" },
    });

    const lateRiser = deps({
      getPreferences: vi.fn().mockResolvedValue({
        ...DEFAULT_PREFERENCES,
        timeZone: "America/Los_Angeles",
        quietHours: { enabled: true, startHour: 0, endHour: 9 },
      }),
    });
    expect(await toolsByName(lateRiser).get_current_time.invoke({})).toMatchObject({
      sleepHours: { from: "12 AM", to: "9 AM" },
    });
  });

  it("list_new_alerts returns the alerts that arrived since the household last looked, whenever they happened", async () => {
    const d = deps();
    const result = (await toolsByName(d).list_new_alerts.invoke({})) as { lastLooked: string; count: number };

    expect(d.listAlerts).toHaveBeenCalledWith({ deliveredSince: LAST_LOOKED, limit: 50 });
    expect(result).toMatchObject({ headline: "You have 3 new alerts: 1 Urgent, 1 Notable and 1 Routine." });
  });

  it("list_new_alerts keeps Routine alerts apart from the ones to describe, since the headline already counts them", async () => {
    const result = (await toolsByName(deps()).list_new_alerts.invoke({})) as {
      alerts: Array<{ signalClass: string; description: string }>;
      routineAlerts: Array<{ signalClass: string; description: string }>;
    };

    expect(result.alerts.map(({ signalClass }) => signalClass)).toEqual(["Notable", "Urgent"]);
    expect(result.routineAlerts.map(({ description }) => description)).toEqual(["A cat walked across the porch."]);
  });

  it("marks each alert with whether it happened during sleep hours, so the model doesn't work it out", async () => {
    const quietHoursOff = deps({
      getPreferences: vi.fn().mockResolvedValue({ ...DEFAULT_PREFERENCES, timeZone: "America/Los_Angeles" }),
    });
    const result = (await toolsByName(quietHoursOff).list_alerts.invoke({})) as {
      alerts: Array<{ time: string; duringSleepHours: boolean }>;
    };
    expect(result.alerts.map(({ time, duringSleepHours }) => [time, duringSleepHours])).toEqual([
      ["today 1:05 PM", false],
      ["today 2:40 AM", true],
      ["today 1:10 AM", true],
    ]);
  });

  it("list_alerts passes the model's filters to the store and describes each alert in local time", async () => {
    const d = deps();
    const result = (await toolsByName(d).list_alerts.invoke({
      since: "2026-10-14T05:00:00Z",
      signalClass: "Urgent",
      limit: 5,
    })) as { count: number; alerts: Array<Record<string, unknown>> };

    expect(d.listAlerts).toHaveBeenCalledWith({
      since: new Date("2026-10-14T05:00:00Z"),
      until: undefined,
      signalClass: "Urgent",
      category: undefined,
      limit: 5,
    });
    expect(result.count).toBe(3);
    expect(result.alerts[1]).toEqual({
      time: "today 2:40 AM",
      duringSleepHours: true,
      device: "Front Door",
      category: "person",
      signalClass: "Urgent",
      signalScore: 82,
      description: "A person in a dark hoodie at the door.",
      repeatVisit: true,
      knownVisitor: false,
    });
  });

  it("list_alerts can keep only the alerts during, or outside, sleep hours, so an overnight answer can't pick up the evening", async () => {
    const d = deps();
    const tools = toolsByName(d);

    const asleep = (await tools.list_alerts.invoke({ duringSleepHours: true, limit: 1 })) as {
      count: number;
      alerts: Array<{ time: string }>;
    };
    // The store is asked for enough alerts to filter before the limit is applied.
    expect(d.listAlerts).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
    expect(asleep).toMatchObject({ count: 1, alerts: [{ time: "today 2:40 AM" }] });

    const awake = (await tools.list_alerts.invoke({ duringSleepHours: false })) as { alerts: Array<{ time: string }> };
    expect(awake.alerts.map(({ time }) => time)).toEqual(["today 1:05 PM"]);
  });

  it("list_alerts rejects a time it can't read, so the model can correct itself", async () => {
    await expect(toolsByName(deps()).list_alerts.invoke({ since: "last night" })).rejects.toThrow(/ISO 8601/);
  });

  it("count_alerts tallies a window by class, category and camera", async () => {
    const result = await toolsByName(deps()).count_alerts.invoke({ since: "2026-10-14T00:00:00Z" });
    expect(result).toEqual({
      total: 3,
      bySignalClass: { Notable: 1, Urgent: 1, Routine: 1 },
      byCategory: { package: 1, person: 1, animal: 1 },
      byCamera: { "Front Door": 3 },
    });
  });
});

describe("newAlertsHeadline", () => {
  const [notable, urgent, routine] = ALERTS;

  it("counts the new alerts by Signal Class, most urgent first, leaving out classes with none", () => {
    expect(newAlertsHeadline([urgent, notable, notable, notable, routine], "x")).toBe(
      "You have 5 new alerts: 1 Urgent, 3 Notable and 1 Routine.",
    );
    expect(newAlertsHeadline([notable, notable], "x")).toBe("You have 2 new alerts: 2 Notable.");
    expect(newAlertsHeadline([routine], "x")).toBe("You have 1 new alert: 1 Routine.");
  });

  it("says plainly when nothing new arrived", () => {
    expect(newAlertsHeadline([], "Tue, Oct 13, 10:00 PM")).toBe("No new alerts since you last looked (Tue, Oct 13, 10:00 PM).");
  });
});

describe("alertTime", () => {
  const LA = "America/Los_Angeles";

  it("says today or yesterday with the time, and gives the full date for anything older", () => {
    expect(alertTime(new Date("2026-10-14T14:20:00Z"), NOW, LA)).toBe("today 7:20 AM");
    expect(alertTime(new Date("2026-10-14T06:36:00Z"), NOW, LA)).toBe("yesterday 11:36 PM");
    expect(alertTime(new Date("2026-10-13T06:36:00Z"), NOW, LA)).toBe("Mon, Oct 12, 11:36 PM");
  });

  it("counts yesterday in calendar days, so a 23-hour day at the switch to daylight time still counts", () => {
    const justAfterMidnight = new Date("2026-03-09T07:30:00Z"); // Mon, Mar 9, 12:30 AM PDT
    // Sun, Mar 8, 12:30 AM PST: 23 hours earlier, yet the day before.
    expect(alertTime(new Date("2026-03-08T08:30:00Z"), justAfterMidnight, LA)).toBe("yesterday 12:30 AM");
  });
});

describe("catchUpPrompt and lastLookedAt", () => {
  it("asks what was missed, or passes the household's own question on unchanged", () => {
    expect(catchUpPrompt({})).toBe("What did I miss?");
    expect(catchUpPrompt({ question: "Did a package come?", since: LAST_LOOKED })).toBe("Did a package come?");
  });

  it("takes the last look from the app, or 24 hours ago", () => {
    expect(lastLookedAt({ since: LAST_LOOKED }, NOW)).toBe(LAST_LOOKED);
    expect(lastLookedAt({}, NOW)).toEqual(new Date("2026-10-13T15:00:00Z"));
  });
});

/**
 * Stands in for Bedrock: each turn emits Strands model stream events,
 * either a tool call or a final text answer, and records what the agent
 * sent it.
 */
class ScriptedModel extends Model {
  readonly received: Message[][] = [];

  constructor(private readonly turns: Array<{ tool: string; input: unknown } | { text: string }>) {
    super();
  }

  updateConfig(): void {}

  getConfig() {
    return { modelId: "scripted" };
  }

  async *stream(messages: Message[]) {
    this.received.push(structuredClone(messages));
    const turn = this.turns.shift();
    if (!turn) throw new Error("The script has no more turns");
    yield { type: "modelMessageStartEvent" as const, role: "assistant" as const };
    if ("tool" in turn) {
      yield {
        type: "modelContentBlockStartEvent" as const,
        start: { type: "toolUseStart" as const, name: turn.tool, toolUseId: `call-${this.received.length}` },
      };
      yield {
        type: "modelContentBlockDeltaEvent" as const,
        delta: { type: "toolUseInputDelta" as const, input: JSON.stringify(turn.input) },
      };
      yield { type: "modelContentBlockStopEvent" as const };
      yield { type: "modelMessageStopEvent" as const, stopReason: "toolUse" };
    } else {
      yield { type: "modelContentBlockStartEvent" as const };
      yield { type: "modelContentBlockDeltaEvent" as const, delta: { type: "textDelta" as const, text: turn.text } };
      yield { type: "modelContentBlockStopEvent" as const };
      yield { type: "modelMessageStopEvent" as const, stopReason: "endTurn" };
    }
  }
}

describe("answerCatchUp", () => {
  it("lets the model choose its tools, feeds it their results, and returns its answer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    const model = new ScriptedModel([
      { tool: "get_current_time", input: {} },
      { tool: "list_alerts", input: { since: "2026-10-14T05:00:00Z" } },
      { text: "One Urgent alert: a person in a dark hoodie at the Front Door at 2:40 AM.\n" },
    ]);

    const answer = await answerCatchUp({ question: "Did anyone come while I was asleep?" }, d, model);

    expect(answer).toBe("One Urgent alert: a person in a dark hoodie at the Front Door at 2:40 AM.");
    expect(d.listAlerts).toHaveBeenCalledWith(expect.objectContaining({ since: new Date("2026-10-14T05:00:00Z") }));

    // Each tool's result went back to the model before its next turn.
    const [first, second, third] = model.received.map((messages) => JSON.stringify(messages));
    expect(first).toContain("Did anyone come while I was asleep?");
    expect(second).toContain("10 PM");
    expect(third).toContain("A person in a dark hoodie at the door.");
    // Short enough, so no rewrite was asked for.
    expect(model.received).toHaveLength(3);
  });

  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("asks once for a shorter answer when the first is too long, in the same conversation", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const long = words(MAX_ANSWER_WORDS + 5);
    const short = "You have 1 new alert: 1 Urgent. A person in a dark hoodie at 2:40 AM.";
    const model = new ScriptedModel([{ text: long }, { text: short }]);

    expect(await answerCatchUp({}, deps(), model)).toBe(short);

    const rewriteRequest = JSON.stringify(model.received[1]);
    expect(rewriteRequest).toContain(long);
    expect(rewriteRequest).toContain(`That answer is ${MAX_ANSWER_WORDS + 5} words`);
    expect(rewriteRequest).toContain("Keep the opening sentence word for word");
  });

  it("keeps the first answer if the rewrite is no shorter", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const first = words(MAX_ANSWER_WORDS + 2);
    const model = new ScriptedModel([{ text: first }, { text: words(MAX_ANSWER_WORDS + 9) }]);

    expect(await answerCatchUp({}, deps(), model)).toBe(first);
    expect(model.received).toHaveLength(2);
  });

  it("counts words the way the limit means them", () => {
    expect(wordCount("  You have 7 new alerts:\n1 Urgent. ")).toBe(7);
  });

  it("gives the model the instructions for a short, plain-text, braille-friendly answer", () => {
    expect(SYSTEM_PROMPT).toMatch(/braille display/);
    expect(SYSTEM_PROMPT).toMatch(/no markdown/);
    expect(SYSTEM_PROMPT).toMatch(/Never guess or invent an event/);
    expect(SYSTEM_PROMPT).toMatch(/list_new_alerts/);
    expect(SYSTEM_PROMPT).toMatch(/duringSleepHours/);
    expect(SYSTEM_PROMPT).toMatch(/headline, word for word/);
    expect(SYSTEM_PROMPT).toMatch(/Never count alerts yourself/);
  });

  it("tells the model to leave out Routine alerts the headline counts, and alerts outside the question", () => {
    expect(SYSTEM_PROMPT).toMatch(/Leave out its routineAlerts/);
    expect(SYSTEM_PROMPT).toMatch(/duringSleepHours set to true/);
    expect(SYSTEM_PROMPT).toMatch(/don't mention alerts from outside the time or the kind of subject asked about/);
  });

  it("tells the model to answer a specific question with only the alerts that answer it", () => {
    expect(SYSTEM_PROMPT).toMatch(/describe only the alerts that answer it and stop/);
    expect(SYSTEM_PROMPT).toMatch(/mention Routine alerts only when there's nothing else/);
    // The old rule, which had every answer list Urgent and Notable alerts and sum up Routine ones, is gone.
    expect(SYSTEM_PROMPT).not.toMatch(/Sum up Routine alerts in one sentence/);
  });
});
