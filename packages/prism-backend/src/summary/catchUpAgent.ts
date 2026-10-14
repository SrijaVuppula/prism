// "What did I miss?": a plain-language catch-up on recent doorbell alerts,
// short enough to read at a glance or on a braille display.
//
// It's a Strands agent on Amazon Bedrock with read-only tools over the
// household's delivered alerts and settings. Unlike the alert pipeline,
// which runs the same fixed steps for every event (see
// bedrock/agentOrchestration.ts), here the model decides what to look up:
// the alerts that arrived since the household last looked, a time window
// such as "this morning", a Signal Class or category, or counts. What the
// model would otherwise have to work out from times -- which alerts are new,
// and which happened during the household's sleep hours -- the tools decide
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

export const SYSTEM_PROMPT = `You are Prism's catch-up assistant. Prism turns Ring doorbell events into alerts for deaf, hard-of-hearing and DeafBlind people. Answer the household's question about their doorbell alerts using only what the tools return. Never guess or invent an event.

Choosing alerts:
- "What did I miss?" or "since I last checked": use list_new_alerts, which returns exactly the alerts that arrived since the household last looked. Mention each Urgent and Notable one.
- "While I was asleep", "overnight" or "last night": every alert says whether it happened during the household's sleep hours (duringSleepHours). Answer only from alerts where it's true, from the most recent night, and leave every other alert out, even if it was recent.
- Other times, such as "today" or "this morning": call get_current_time first, then list_alerts with since and until.

Write for someone reading quickly or on a braille display: plain sentences, no markdown, no lists with symbols, no tables, no emoji. Start with the direct answer in one sentence. Then give what matters most first: Urgent alerts, then Notable ones. Sum up Routine alerts in one sentence unless asked about them. Use the times as the tools give them. Keep the whole answer under 80 words.

Don't say who a visitor is unless a tool marks them as a known visitor; describe what the camera saw instead. If there were no matching alerts, say so plainly.`;

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
function describeAlert(message: CompanionEventMessage, preferences: UserPreferences) {
  const { event, device } = message;
  const timeZone = householdZone(preferences);
  const occurredAt = new Date(event.occurredAt);
  const breakdown = event.scoring?.breakdown ?? {};
  return {
    time: localTime(occurredAt, timeZone),
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
      "The alerts that arrived since the household last looked at Prism, most recent first: the answer to \"What did I miss?\". Each says when it happened, which camera, what the camera saw, and its Signal Class.",
    inputSchema: z.object({}),
    callback: async () => {
      const preferences = await deps.getPreferences();
      const alerts = await deps.listAlerts({ deliveredSince: lastLooked, limit: MAX_LISTED_ALERTS });
      return {
        lastLooked: localTime(lastLooked, householdZone(preferences)),
        count: alerts.length,
        alerts: alerts.map((alert) => describeAlert(alert, preferences)),
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
      limit: z.number().int().min(1).max(MAX_LISTED_ALERTS).optional().describe("At most this many alerts (default 20)"),
    }),
    callback: async (input) => {
      const preferences = await deps.getPreferences();
      const alerts = await deps.listAlerts({
        since: parseTime(input.since, "since"),
        until: parseTime(input.until, "until"),
        signalClass: input.signalClass,
        category: input.category,
        limit: input.limit ?? 20,
      });
      return { count: alerts.length, alerts: alerts.map((alert) => describeAlert(alert, preferences)) };
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
      const tally = (key: (alert: CompanionEventMessage) => string | undefined) => {
        const counts: Record<string, number> = {};
        for (const alert of alerts) {
          const value = key(alert);
          if (value) counts[value] = (counts[value] ?? 0) + 1;
        }
        return counts;
      };
      return {
        total: alerts.length,
        bySignalClass: tally((alert) => alert.event.scoring?.signalClass),
        byCategory: tally((alert) => alert.event.classification?.category),
        byCamera: tally((alert) => alert.device?.name ?? "Doorbell"),
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

/** Runs the agent and returns its plain-text answer. */
export async function answerCatchUp(
  request: CatchUpRequest,
  deps: CatchUpDeps = defaultDeps(),
  model: Model = defaultModel(),
): Promise<string> {
  const tools = buildCatchUpTools(deps, lastLookedAt(request, deps.now()));
  const agent = new Agent({ model, systemPrompt: SYSTEM_PROMPT, tools, printer: false });
  const startedAt = Date.now();
  const result = await agent.invoke(catchUpPrompt(request));
  console.log(`[catch-up] answered in ${Date.now() - startedAt} ms`);
  return result.toString().trim();
}
