// The household's stored data, for the companion app's "Your data" settings:
// how long alert history is kept and how much is stored, and deleting it.
// Deleting removes the same history `npm run clear-history` does (events,
// repeat-visitor memory, feedback and visitor tags); settings, push
// subscriptions and the Ring account link are kept. See docs/PRIVACY.md.

import { Router } from "express";
import { clearHistory } from "../db/clearHistory";
import { getPool } from "../db/pool";
import { getHistoryRetentionDays } from "../db/retention";
import { resetSignalScoreWeightsCache } from "../feedback/weightAdjustment";
import { getRingSnapshotLoader } from "../ring/snapshots";

export const dataRouter = Router();

dataRouter.get("/data", async (_req, res, next) => {
  try {
    const { rows } = await getPool().query<{ count: string }>("SELECT count(*) AS count FROM ring_events");
    res.json({ retentionDays: getHistoryRetentionDays(), storedAlerts: Number(rows[0]?.count ?? 0) });
  } catch (err) {
    next(err);
  }
});

dataRouter.delete("/data/history", async (_req, res, next) => {
  try {
    await clearHistory(getPool());
    // Forget what was derived from the deleted history right away: the
    // feedback-adjusted scoring weights and recently downloaded snapshots.
    resetSignalScoreWeightsCache();
    getRingSnapshotLoader().clear();
    console.log("[data] alert history deleted from the companion app");
    res.json({ storedAlerts: 0 });
  } catch (err) {
    next(err);
  }
});
