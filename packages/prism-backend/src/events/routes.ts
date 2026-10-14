// Recent alerts and event snapshots for the companion app.
//
// GET /alerts lists the most recent delivered alerts, so the app shows them
// after a reload rather than only what arrived while it was open.
//
// GET /events/:eventId/snapshot serves an event's snapshot image. The app
// can't use the snapshot URL directly: simulator events point at local
// file:// URLs that a browser won't load into a web page, and a camera
// vendor's snapshot URLs may need credentials only the backend holds.

import { Router } from "express";
import { loadSnapshotBytes } from "../bedrock/multimodalContext";
import { getAlertHistoryStore } from "../db/alertHistoryStore";
import { getRingEventStore } from "../db/eventStore";

export const eventsRouter = Router();

const DEFAULT_ALERT_LIMIT = 20;
const MAX_ALERT_LIMIT = 50;

eventsRouter.get("/alerts", async (req, res, next) => {
  const requested = Number(req.query.limit ?? DEFAULT_ALERT_LIMIT);
  if (!Number.isInteger(requested) || requested < 1) {
    res.status(400).json({ error: "limit must be a positive whole number" });
    return;
  }
  try {
    const alerts = await getAlertHistoryStore().list({ limit: Math.min(requested, MAX_ALERT_LIMIT) });
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

eventsRouter.get("/events/:eventId/snapshot", async (req, res, next) => {
  let snapshotUrl: string;
  try {
    const event = await getRingEventStore().get(req.params.eventId);
    if (!event) {
      res.status(404).json({ error: "Unknown event" });
      return;
    }
    snapshotUrl = event.snapshotUrl;
  } catch (err) {
    next(err);
    return;
  }

  try {
    const { bytes, mediaType } = await loadSnapshotBytes(snapshotUrl);
    // Snapshots never change once an event is stored.
    res.type(mediaType).set("Cache-Control", "private, max-age=86400").send(bytes);
  } catch (err) {
    console.error(`[events] snapshot unavailable for event ${req.params.eventId}:`, err);
    res.status(502).json({ error: "Snapshot unavailable" });
  }
});
