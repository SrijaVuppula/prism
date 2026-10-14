// "What did I miss?": a plain-language catch-up on recent doorbell alerts,
// short enough to read at a glance or on a braille display.
//
// It's a Strands agent on Amazon Bedrock with read-only tools over the
// household's delivered alerts and settings. Unlike the alert pipeline,
// which runs the same fixed steps for every event (see
// bedrock/agentOrchestration.ts), here the model decides what to look up:
// which time window "while I was asleep" or "this morning" means, whether to
// filter by Signal Class or category, and whether counts or individual
// alerts answer the question. See docs/ARCHITECTURE.md.

import { Agent, BedrockModel, tool, type Model } from "@strands-agents/sdk";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import { z } from "zod";
import type { CompanionEventMessage } from "../api/websocket";
import { getBedrockConfig } from "../bedrock/config";
import { getAlertHistoryStore, type AlertQuery } from "../db/alertHistoryStore";
import { getPreferencesStore, type UserPreferences } from "../preferences/preferencesStore";
import { DEFAULT_TIME_ZONE, isValidTimeZone } from "../preferences/timeZone";

export interface CatchUpDeps {
  listAlerts: (query: AlertQuery) => Promise<CompanionEventMessage[]>;
  getPreferences: () => Promise<UserPreferences>;
  now: () => Date;
}

export interface CatchUpRequest {
  /** The household's own question. Without one, the answer summarizes everything since `since`. */
  question?: string;
  /** When the household last looked at its alerts. Defaults to 24 hours ago. */
  since?: Date;
}

const SIGNAL_CLASSES = ["Urgent", "Notable", "Routine"] as const satisfies readonly SignalClass[];
const CATEGORIES = ["person", "package", "vehicle", "animal"] as const satisfies readonly EventCategory[];
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_LISTED_ALERTS = 50;
const MAX_COUNTED_ALERTS = 500;

export const SYSTEM_PROMPT = `You are Prism's catch-up assistant. Prism turns Ring doorbell events into alerts for deaf, hard-of-hearing and DeafBlind people. Answer the household's question about their doorbell alerts using only what the tools return. Never guess or invent an event.

Call get_current_time first, to work out what phrases like "today", "this morning" or "last night" mean. For "while I was asleep", use the quiet hours if they're set, otherwise 10 PM to 7 AM.

Write for someone reading quickly or on a braille display: plain sentences, no markdown, no lists with symbols, no tables, no emoji. Start with the direct answer in one sentence. Then give what matters most first: Urgent alerts, then Notable ones. Sum up Routine alerts in one sentence unless asked about them. Use the times as the tools give them. Keep the whole answer under 80 words.

Don't say who a visitor is unless a tool marks them as a known visitor; describe what the camera saw instead. If there were no alerts, say so plainly.`;

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
function describeAlert(message: CompanionEventMessage, timeZone: string) {
  const { event, device } = message;
  const breakdown = event.scoring?.breakdown ?? {};
  return {
    time: localTime(new Date(event.occurredAt), timeZone),
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

/** The agent's tools. All of them only read. */
export function buildCatchUpTools(deps: CatchUpDeps) {
  const getCurrentTime = tool({
    name: "get_current_time",
    description:
      "The current date and time in the household's time zone, and the household's quiet hours (when they usually don't want to be disturbed, often while asleep).",
    inputSchema: z.object({}),
    callback: async () => {
      const preferences = await deps.getPreferences();
      const timeZone = householdZone(preferences);
      const now = deps.now();
      const { quietHours } = preferences;
      return {
        now: now.toISOString(),
        localTime: localTime(now, timeZone),
        timeZone,
        quietHours: quietHours.enabled
          ? { from: hourLabel(quietHours.startHour), to: hourLabel(quietHours.endHour) }
          : "not set",
      };
    },
  });

  const listAlerts = tool({
    name: "list_alerts",
    description:
      "Alerts the doorbell sent, most recent first, with when each happened (in the household's time zone), which camera, what the camera saw, and its Signal Class: Urgent, Notable or Routine.",
    inputSchema: z.object({
      since: timeField("Only alerts at or after this time"),
      until: timeField("Only alerts before this time"),
      signalClass: z.enum(SIGNAL_CLASSES).optional().describe("Only alerts of this Signal Class"),
      category: z.enum(CATEGORIES).optional().describe("Only alerts about this kind of subject"),
      limit: z.number().int().min(1).max(MAX_LISTED_ALERTS).optional().describe("At most this many alerts (default 20)"),
    }),
    callback: async (input) => {
      const timeZone = householdZone(await deps.getPreferences());
      const alerts = await deps.listAlerts({
        since: parseTime(input.since, "since"),
        until: parseTime(input.until, "until"),
        signalClass: input.signalClass,
        category: input.category,
        limit: input.limit ?? 20,
      });
      return { count: alerts.length, alerts: alerts.map((alert) => describeAlert(alert, timeZone)) };
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

  return [getCurrentTime, listAlerts, countAlerts];
}

/** What the agent is asked: the household's question, or a catch-up since they last looked. */
export function catchUpPrompt(request: CatchUpRequest, now: Date): string {
  const since = (request.since ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MS)).toISOString();
  if (request.question) {
    return `${request.question}\n\n(The household last looked at their alerts at ${since}.)`;
  }
  return `What did I miss? Catch me up on the doorbell alerts since ${since}.`;
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
  const agent = new Agent({ model, systemPrompt: SYSTEM_PROMPT, tools: buildCatchUpTools(deps), printer: false });
  const startedAt = Date.now();
  const result = await agent.invoke(catchUpPrompt(request, deps.now()));
  console.log(`[catch-up] answered in ${Date.now() - startedAt} ms`);
  return result.toString().trim();
}
