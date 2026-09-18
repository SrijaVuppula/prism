// Endpoints for reading and updating the household's alert preferences
// (haptic overrides, quiet hours, known-visitor-tagging opt-in). Same
// single-household shape as preferencesStore.ts -- no userId in the
// request, matching push/routes.ts and the rest of the no-auth codebase.

import express, { Router } from "express";
import type { HapticOverrides, SignalClass } from "prism-alert-engine";
import { getPreferencesStore, type UserPreferences } from "./preferencesStore";

export const preferencesRouter = Router();

const SIGNAL_CLASSES: ReadonlySet<string> = new Set<SignalClass>(["Routine", "Notable", "Urgent"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidHapticOverrides(value: unknown): value is HapticOverrides {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([signalClass, pattern]) =>
      SIGNAL_CLASSES.has(signalClass) &&
      Array.isArray(pattern) &&
      pattern.length > 0 &&
      pattern.every((ms) => typeof ms === "number" && ms >= 0),
  );
}

function isValidHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isValidPreferencesBody(body: unknown): body is UserPreferences {
  if (!isRecord(body)) return false;

  const quietHours = body.quietHours;
  if (
    !isRecord(quietHours) ||
    typeof quietHours.enabled !== "boolean" ||
    !isValidHour(quietHours.startHourUtc) ||
    !isValidHour(quietHours.endHourUtc)
  ) {
    return false;
  }

  if (typeof body.knownVisitorTaggingEnabled !== "boolean") return false;
  if (!isValidHapticOverrides(body.hapticOverrides)) return false;

  return true;
}

preferencesRouter.get("/preferences", async (_req, res, next) => {
  try {
    const preferences = await getPreferencesStore().get();
    res.json(preferences);
  } catch (err) {
    next(err);
  }
});

preferencesRouter.put("/preferences", express.json(), async (req, res, next) => {
  if (!isValidPreferencesBody(req.body)) {
    res.status(400).json({
      error:
        "Expected { hapticOverrides, quietHours: { enabled, startHourUtc, endHourUtc }, knownVisitorTaggingEnabled }",
    });
    return;
  }

  try {
    const saved = await getPreferencesStore().save(req.body);
    res.json(saved);
  } catch (err) {
    next(err);
  }
});

