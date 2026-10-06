// Clears alert history so a demo or test run starts fresh: stored events,
// repeat-visitor memory, alert feedback (and with it the feedback-adjusted
// scoring weights), and visitor tags. The household's settings, push
// subscriptions and linked Ring account are kept.
//
// Usage: npm run clear-history (DATABASE_URL comes from the environment or
// packages/prism-backend/.env)

import type { Pool } from "pg";
import { loadEnv } from "../loadEnv";
import { getPool } from "./pool";

export const HISTORY_TABLES = ["ring_events", "event_embeddings", "alert_feedback", "known_visitor_tags"];

export async function clearHistory(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${HISTORY_TABLES.join(", ")}`);
}

async function main(): Promise<void> {
  loadEnv();
  const pool = getPool();
  try {
    await clearHistory(pool);
    console.log(
      `[clear-history] cleared ${HISTORY_TABLES.join(", ")}; settings, push subscriptions and the Ring account link were kept. ` +
        "A running backend picks up the reset scoring weights within a minute.",
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[clear-history] failed:", err);
    process.exitCode = 1;
  });
}
