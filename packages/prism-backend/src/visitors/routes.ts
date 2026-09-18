// Opt-in known-visitor tagging endpoints. Strictly gated by
// preferences.knownVisitorTaggingEnabled -- see docs/ACCESSIBILITY.md's
// privacy note (opt-in only, disclosed clearly, local-only storage) --
// so tagging is refused with a clear error until the household has turned
// the feature on in Settings, rather than silently no-op'ing or (worse)
// tagging anyway.

import express, { Router } from "express";
import { getKnownVisitorTagStore } from "../db/knownVisitorTagStore";
import { getPreferencesStore } from "../preferences/preferencesStore";

export const visitorsRouter = Router();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requireTaggingOptIn(res: express.Response): Promise<boolean> {
  const preferences = await getPreferencesStore().get();
  if (!preferences.knownVisitorTaggingEnabled) {
    res.status(403).json({
      error: "Known-visitor tagging is off. Enable it in Settings before tagging a visitor.",
    });
    return false;
  }
  return true;
}

visitorsRouter.post("/visitors/:visitorGroupId/tag", express.json(), async (req, res, next) => {
  const { visitorGroupId } = req.params;
  const label = isRecord(req.body) ? req.body.label : undefined;
  if (typeof label !== "string" || label.trim().length === 0) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  try {
    if (!(await requireTaggingOptIn(res))) return;
    await getKnownVisitorTagStore().tag(visitorGroupId, label.trim());
    res.status(201).json({ status: "tagged", visitorGroupId, label: label.trim() });
  } catch (err) {
    next(err);
  }
});

visitorsRouter.delete("/visitors/:visitorGroupId/tag", async (req, res, next) => {
  try {
    await getKnownVisitorTagStore().remove(req.params.visitorGroupId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

visitorsRouter.get("/visitors/:visitorGroupId/tag", async (req, res, next) => {
  try {
    const tag = await getKnownVisitorTagStore().find(req.params.visitorGroupId);
    if (!tag) {
      res.status(404).json({ error: "No tag for this visitor group" });
      return;
    }
    res.json(tag);
  } catch (err) {
    next(err);
  }
});
