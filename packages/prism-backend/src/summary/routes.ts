// POST /catch-up: the companion app's "What did I miss?" (see
// catchUpAgent.ts). Body: { question?: string, since?: ISO date-time }.
// Answers { answer } in plain text.

import express, { Router } from "express";
import { answerCatchUp, type CatchUpRequest } from "./catchUpAgent";

export const summaryRouter = Router();

const MAX_QUESTION_LENGTH = 300;

function parseRequest(body: unknown): CatchUpRequest | string {
  const { question, since } = (body ?? {}) as { question?: unknown; since?: unknown };
  const request: CatchUpRequest = {};
  if (question !== undefined && question !== null && question !== "") {
    if (typeof question !== "string" || question.trim().length > MAX_QUESTION_LENGTH) {
      return `question must be text of at most ${MAX_QUESTION_LENGTH} characters`;
    }
    if (question.trim()) request.question = question.trim();
  }
  if (since !== undefined && since !== null) {
    const date = typeof since === "string" ? new Date(since) : new Date(NaN);
    if (Number.isNaN(date.getTime())) return "since must be an ISO 8601 date-time";
    request.since = date;
  }
  return request;
}

summaryRouter.post("/catch-up", express.json(), async (req, res) => {
  const request = parseRequest(req.body);
  if (typeof request === "string") {
    res.status(400).json({ error: request });
    return;
  }
  try {
    res.json({ answer: await answerCatchUp(request) });
  } catch (err) {
    console.error("[catch-up] couldn't answer:", err);
    res.status(502).json({ error: "The catch-up summary isn't available right now." });
  }
});
