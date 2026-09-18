// Endpoint for thumbs up/down feedback on a dispatched alert's
// classification (companion app's ContextCard). category/signalClass/
// signalScore are supplied by the client rather than looked up server-side:
// the companion app already has them from the WebSocket message it
// rendered (see api/websocket.ts's CompanionEventMessage), and ring_events
// has no classification/scoring columns to look them up from -- see the
// module comment on db/migrations/0008_alert_feedback.sql.

import express, { Router } from "express";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import { getFeedbackStore, type FeedbackVote } from "./feedbackStore";

export const feedbackRouter = Router();

const CATEGORIES: ReadonlySet<string> = new Set<EventCategory>(["person", "package", "vehicle", "animal"]);
const SIGNAL_CLASSES: ReadonlySet<string> = new Set<SignalClass>(["Routine", "Notable", "Urgent"]);
const VOTES: ReadonlySet<string> = new Set<FeedbackVote>(["up", "down"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidFeedbackBody(
  body: unknown,
): body is { vote: FeedbackVote; category: EventCategory; signalClass: SignalClass; signalScore: number } {
  return (
    isRecord(body) &&
    typeof body.vote === "string" &&
    VOTES.has(body.vote) &&
    typeof body.category === "string" &&
    CATEGORIES.has(body.category) &&
    typeof body.signalClass === "string" &&
    SIGNAL_CLASSES.has(body.signalClass) &&
    typeof body.signalScore === "number" &&
    body.signalScore >= 0 &&
    body.signalScore <= 100
  );
}

feedbackRouter.post("/alerts/:eventId/feedback", express.json(), async (req, res, next) => {
  if (!isValidFeedbackBody(req.body)) {
    res.status(400).json({ error: "Expected { vote: 'up' | 'down', category, signalClass, signalScore }" });
    return;
  }

  try {
    await getFeedbackStore().record({ eventId: req.params.eventId, ...req.body });
    res.status(201).json({ status: "recorded" });
  } catch (err) {
    next(err);
  }
});
