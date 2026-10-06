// Serves an event's snapshot image to the companion app. The app can't use
// the snapshot URL directly: simulator events point at local file:// URLs
// that a browser won't load into a web page, and a camera vendor's snapshot
// URLs may need credentials only the backend holds.

import { Router } from "express";
import { loadSnapshotBytes } from "../bedrock/multimodalContext";
import { getRingEventStore } from "../db/eventStore";

export const eventsRouter = Router();

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
