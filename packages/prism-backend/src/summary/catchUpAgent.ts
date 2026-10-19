// "What did I miss?": a plain-language catch-up on recent doorbell alerts,
// short enough to read at a glance or on a braille display.
//
// It's a Strands agent on Amazon Bedrock with read-only tools over the
// household's delivered alerts and settings. Unlike the alert pipeline,
// which runs the same fixed steps for every event (see
// bedrock/agentOrchestration.ts), here the model decides what to look up:
// the alerts that arrived since the household last looked, a time window
// such as "this morning", a Signal Class or category, or counts. What the
// model would otherwise have to work out from times - which alerts are new,
// and which happened during the household's sleep hours - the tools decide
// in code and report on each alert. See docs/ARCHITECTURE.md.

import { Agent, BedrockModel, tool, type Model } from "@strands-agents/sdk";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import { z } from "zod";
import type { CompanionEventMessage } from "../api/websocket";
import { getBedrockConfig } from "../bedrock/config";
import { getAlertHistoryStore, type AlertQuery } from "../db/alertHistoryStore";
import { getPreferencesStore, type UserPreferences } from "../preferences/preferencesStore";
import { isWithinQuietHours, type QuietHours } from "../preferences/quietHours";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "../preferences/timeZone";

export interface CatchUpDeps {
  listAlerts: (query: AlertQuery) => Promise<CompanionEventMessage[]>;
  getPreferences: () => Promise<UserPreferences>;
  now: () => Date;
}

export interface CatchUpRequest {
  /** The household's own question. Without one, the answer summarizes the alerts that arrived since `since`. */
  question?: string;
  /** When the household last looked at its alerts. Defaults to 24 hours ago. */
  since?: Date;
}

/**
 * When the household is usually asleep: its quiet hours when they're on,
 * otherwise 10 PM to 7 AM. Each alert the tools return says whether it
 * happened in this window, so "while I was asleep" doesn't depend on the
 * model working out times.
 */
const DEFAULT_SLEEP_HOURS: QuietHours = { enabled: true, startHour: 22, endHour: 7 };

function sleepHours(preferences: UserPreferences): QuietHours {
  return preferences.quietHours.enabled ? preferences.quietHours : DEFAULT_SLEEP_HOURS;
}

const SIGNAL_CLASSES = ["Urgent", "Notable", "Routine"] as const satisfies readonly SignalClass[];
const CATEGORIES = ["person", "package", "vehicle", "animal"] as const satisfies readonly EventCategory[];
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_LISTED_ALERTS = 50;
const MAX_COUNTED_ALERTS = 500;
/** Answers must be shorter than this, to read at a glance or on a braille display. */
export const MAX_ANSWER_WORDS = 80;

export const SYSTEM_PROMPT = `You are Prism's catch-up assistant. Prism turns Ring doorbell events into alerts for deaf, hard-of-hearing and DeafBlind people. Answer the household's question about their doorbell alerts using only what the tools return. Never guess or invent an event.

Choosing alerts:
- "What did I miss?" or "since I last checked": use list_new_alerts, which returns exactly the alerts that arrived since the household last looked. Start your answer with its headline, word for word, then describe each alert in its alerts (the Urgent and Notable ones) without giving any other counts. Leave out its routineAlerts, which the headline already counts, unless there are no other alerts; then sum them up in one sentence.
- "While I was asleep", "overnight" or "last night": call get_current_time first, then list_alerts with duringSleepHours set to true, so only alerts from the household's sleep hours come back. Answer only from those, from the most recent night, and leave every other alert out, even if it was recent.
- Other times, such as "today" or "this morning": call get_current_time first, then list_alerts with since and until.

Never count alerts yourself; use the counts and headlines the tools give. When an alert is a repeatVisit, say the same visitor came again rather than describing them as someone new.

Write for someone reading quickly or on a braille display: plain sentences, no markdown, no lists with symbols, no tables, no emoji. Start with the direct answer in one sentence. For a specific question, such as whether a package came or whether someone came back, describe only the alerts that answer it and stop: don't add other alerts, even Urgent ones, because the household already got those as alerts. For a general question, such as "What did I miss?" or whether there's anything to worry about, give what matters most first: Urgent alerts, then Notable ones, and mention Routine alerts only when there's nothing else. Use the times as the tools give them. Keep the whole answer under ${MAX_ANSWER_WORDS} words.

Don't say who a visitor is unless a tool marks them as a known visitor; describe what the camera saw instead. If there were no matching alerts, say so plainly in one sentence and stop: don't mention alerts from outside the time or the kind of subject asked about.`;

function householdZone(preferences: UserPreferences): string {
  return isValidTimeZone(preferences.timeZone) ? preferences.timeZone : DEFAULT_TIME_ZONE;
}

function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** The calendar day of `date` in `timeZone`, as YYYY-MM-DD. */
function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The calendar day before `day` (YYYY-MM-DD), counted in days rather than 24 hours so DST changes don't matter. */
function dayBefore(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
}

/**
 * When an alert happened, as short as it can be said: "today 8:20 AM",
 * "yesterday 11:36 PM", or the full date for anything older. With full
 * dates on every alert, the model repeated them ("at 8:20 AM on Tue, Oct
 * 20") and a busy night's answer ran past its word limit.
 */
export function alertTime(date: Date, now: Date, timeZone: string): string {
  const day = localDay(date, timeZone);
  const today = localDay(now, timeZone);
  if (day !== today && day !== dayBefore(today)) return localTime(date, timeZone);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  return `${day === today ? "today" : "yesterday"} ${time}`;
}

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

function parseTime(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be an ISO 8601 date-time, e.g. 2026-10-14T06:00:00Z`);
  }
  return date;
}

/** One alert as the agent sees it: what happened, where, when, and how it was scored. */
function describeAlert(message: CompanionEventMessage, preferences: UserPreferences, now: Date) {
  const { event, device } = message;
  const timeZone = householdZone(preferences);
  const occurredAt = new Date(event.occurredAt);
  const breakdown = event.scoring?.breakdown ?? {};
  return {
    time: alertTime(occurredAt, now, timeZone),
    duringSleepHours: isWithinQuietHours(occurredAt, sleepHours(preferences), timeZone),
    device: device?.name ?? "Doorbell",
    category: event.classification?.category,
    signalClass: event.scoring?.signalClass,
    signalScore: event.scoring?.signalScore,
    description: event.classification?.description,
    repeatVisit: (breakdown.repeatVisit ?? 0) !== 0,
    knownVisitor: (breakdown.knownVisitor ?? 0) !== 0,
  };
}

/** How many alerts have each value of `key`. */
function tallyBy(alerts: CompanionEventMessage[], key: (alert: CompanionEventMessage) => string | undefined) {
  const counts: Record<string, number> = {};
  for (const alert of alerts) {
    const value = key(alert);
    if (value) counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/**
 * The opening sentence of "What did I miss?", counted in code: "You have 5
 * new alerts: 1 Urgent, 3 Notable and 1 Routine." The model is told to use
 * it as written, since left to count for itself it merged a repeat visit
 * into one alert.
 */
export function newAlertsHeadline(alerts: CompanionEventMessage[], lastLooked: string): string {
  if (alerts.length === 0) return `No new alerts since you last looked (${lastLooked}).`;
  const counts = tallyBy(alerts, (alert) => alert.event.scoring?.signalClass);
  const parts = SIGNAL_CLASSES.filter((signalClass) => counts[signalClass]).map(
    (signalClass) => `${counts[signalClass]} ${signalClass}`,
  );
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  const total = `${alerts.length} new ${alerts.length === 1 ? "alert" : "alerts"}`;
  return list ? `You have ${total}: ${list}.` : `You have ${total}.`;
}

const timeField = (what: string) =>
  z.string().optional().describe(`${what}, as an ISO 8601 date-time with a UTC offset, e.g. 2026-10-14T06:00:00Z`);

/**
 * The agent's tools. All of them only read. `lastLooked` is when the
 * household last looked at its alerts, for list_new_alerts.
 */
export function buildCatchUpTools(deps: CatchUpDeps, lastLooked: Date) {
  const getCurrentTime = tool({
    name: "get_current_time",
    description:
      "The current date and time in the household's time zone, and its sleep hours (its quiet hours, or 10 PM to 7 AM when none are set).",
    inputSchema: z.object({}),
    callback: async () => {
      const preferences = await deps.getPreferences();
      const timeZone = householdZone(preferences);
      const now = deps.now();
      const sleep = sleepHours(preferences);
      return {
        now: now.toISOString(),
        localTime: localTime(now, timeZone),
        timeZone,
        sleepHours: { from: hourLabel(sleep.startHour), to: hourLabel(sleep.endHour) },
      };
    },
  });

  const listNewAlerts = tool({
    name: "list_new_alerts",
    description:
      "The alerts that arrived since the household last looked at Prism, most recent first: the answer to \"What did I miss?\". The Urgent and Notable ones are in alerts and the Routine ones in routineAlerts. Each says when it happened, which camera, what the camera saw, and its Signal Class.",
    inputSchema: z.object({}),
    callback: async () => {
      const preferences = await deps.getPreferences();
      const alerts = await deps.listAlerts({ deliveredSince: lastLooked, limit: MAX_LISTED_ALERTS });
      const looked = localTime(lastLooked, householdZone(preferences));
      const described = alerts.map((alert) => describeAlert(alert, preferences, deps.now()));
      // Routine alerts are kept apart: the headline already counts them, and
      // describing each one made a busy night's answer too long to read at a glance.
      return {
        headline: newAlertsHeadline(alerts, looked),
        alerts: described.filter((alert) => alert.signalClass !== "Routine"),
        routineAlerts: described.filter((alert) => alert.signalClass === "Routine"),
      };
    },
  });

  const listAlerts = tool({
    name: "list_alerts",
    description:
      "Alerts the doorbell sent in a time window, most recent first. Each says when it happened (in the household's time zone), whether that was during the household's sleep hours, which camera, what the camera saw, and its Signal Class: Urgent, Notable or Routine.",
    inputSchema: z.object({
      since: timeField("Only alerts at or after this time"),
      until: timeField("Only alerts before this time"),
      signalClass: z.enum(SIGNAL_CLASSES).optional().describe("Only alerts of this Signal Class"),
      category: z.enum(CATEGORIES).optional().describe("Only alerts about this kind of subject"),
      duringSleepHours: z
        .boolean()
        .optional()
        .describe("Only alerts during (true) or outside (false) the household's sleep hours"),
      limit: z.number().int().min(1).max(MAX_LISTED_ALERTS).optional().describe("At most this many alerts (default 20)"),
    }),
    callback: async (input) => {
      const preferences = await deps.getPreferences();
      const limit = input.limit ?? 20;
      const bySleepHours = input.duringSleepHours !== undefined;
      const alerts = await deps.listAlerts({
        since: parseTime(input.since, "since"),
        until: parseTime(input.until, "until"),
        signalClass: input.signalClass,
        category: input.category,
        // Sleep hours are worked out here, not in the store, so fetch enough to filter.
        limit: bySleepHours ? MAX_COUNTED_ALERTS : limit,
      });
      const described = alerts
        .map((alert) => describeAlert(alert, preferences, deps.now()))
        .filter((alert) => !bySleepHours || alert.duringSleepHours === input.duringSleepHours)
        .slice(0, limit);
      return { count: described.length, alerts: described };
    },
  });

  const countAlerts = tool({
    name: "count_alerts",
    description: "How many alerts there were in a time window, by Signal Class, by category and by camera.",
    inputSchema: z.object({
      since: timeField("Count alerts at or after this time"),
      until: timeField("Count alerts before this time"),
    }),
    callback: async (input) => {
      const alerts = await deps.listAlerts({
        since: parseTime(input.since, "since"),
        until: parseTime(input.until, "until"),
        limit: MAX_COUNTED_ALERTS,
      });
      return {
        total: alerts.length,
        bySignalClass: tallyBy(alerts, (alert) => alert.event.scoring?.signalClass),
        byCategory: tallyBy(alerts, (alert) => alert.event.classification?.category),
        byCamera: tallyBy(alerts, (alert) => alert.device?.name ?? "Doorbell"),
      };
    },
  });

  return [getCurrentTime, listNewAlerts, listAlerts, countAlerts];
}

/** When the household last looked: as the app reports it, or 24 hours ago. */
export function lastLookedAt(request: CatchUpRequest, now: Date): Date {
  return request.since ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MS);
}

/** What the agent is asked: the household's own question, or what they missed. */
export function catchUpPrompt(request: CatchUpRequest): string {
  return request.question ?? "What did I miss?";
}

function defaultModel(): Model {
  const { region, modelId } = getBedrockConfig();
  // The Converse API (no streaming), so the same bedrock:InvokeModel
  // permission classification uses is enough (infra/aws).
  return new BedrockModel({ region, modelId, temperature: 0, maxTokens: 500, stream: false });
}

const defaultDeps = (): CatchUpDeps => ({
  listAlerts: (query) => getAlertHistoryStore().list(query),
  getPreferences: () => getPreferencesStore().get(),
  now: () => new Date(),
});

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** What the agent is asked when its answer is too long. */
export function shortenPrompt(words: number): string {
  return `That answer is ${words} words. Rewrite it in under ${MAX_ANSWER_WORDS} words, in the same plain style. Keep the opening sentence word for word and every Urgent alert; shorten the rest, and leave out Routine alerts first. Don't call any tools.`;
}

/**
 * Runs the agent and returns its plain-text answer. The word limit is
 * checked in code: with several Urgent and Notable alerts, the model
 * often ran past it, so an answer that's too long gets one rewrite in the
 * same conversation, and the shorter of the two is returned.
 */
export async function answerCatchUp(
  request: CatchUpRequest,
  deps: CatchUpDeps = defaultDeps(),
  model: Model = defaultModel(),
): Promise<string> {
  const tools = buildCatchUpTools(deps, lastLookedAt(request, deps.now()));
  const agent = new Agent({ model, systemPrompt: SYSTEM_PROMPT, tools, printer: false });
  const startedAt = Date.now();
  let answer = (await agent.invoke(catchUpPrompt(request))).toString().trim();
  const words = wordCount(answer);
  if (words >= MAX_ANSWER_WORDS) {
    const rewrite = (await agent.invoke(shortenPrompt(words))).toString().trim();
    if (rewrite && wordCount(rewrite) < words) answer = rewrite;
    console.log(`[catch-up] answered in ${Date.now() - startedAt} ms (shortened from ${words} to ${wordCount(answer)} words)`);
  } else {
    console.log(`[catch-up] answered in ${Date.now() - startedAt} ms`);
  }
  return answer;
}
