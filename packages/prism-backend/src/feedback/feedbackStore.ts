// Postgres-backed storage for thumbs up/down feedback on a dispatched
// alert's classification (ContextCard in the companion app). One vote per
// event -- a changed mind overwrites the prior vote rather than
// accumulating duplicates.

import type { Pool } from "pg";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import { getPool } from "../db/pool";

export type FeedbackVote = "up" | "down";

export interface AlertFeedback {
  eventId: string;
  category: EventCategory;
  signalClass: SignalClass;
  signalScore: number;
  vote: FeedbackVote;
}

/** Per-category tally of up/down votes, as aggregated by CategoryFeedbackTally. */
export type CategoryFeedbackTally = Partial<Record<EventCategory, { up: number; down: number }>>;

export class FeedbackStore {
  constructor(private readonly pool: Pool) {}

  async record(feedback: AlertFeedback): Promise<void> {
    await this.pool.query(
      `INSERT INTO alert_feedback (event_id, category, signal_class, signal_score, vote, created_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (event_id) DO UPDATE SET
         category = EXCLUDED.category,
         signal_class = EXCLUDED.signal_class,
         signal_score = EXCLUDED.signal_score,
         vote = EXCLUDED.vote,
         created_at = now()`,
      [feedback.eventId, feedback.category, feedback.signalClass, feedback.signalScore, feedback.vote],
    );
  }

  /** Per-category up/down counts, across all recorded feedback. */
  async getCategoryTally(): Promise<CategoryFeedbackTally> {
    const result = await this.pool.query<{ category: EventCategory; vote: FeedbackVote; count: string }>(
      `SELECT category, vote, COUNT(*)::text AS count
       FROM alert_feedback
       GROUP BY category, vote`,
    );

    const tally: CategoryFeedbackTally = {};
    for (const row of result.rows) {
      const entry = tally[row.category] ?? { up: 0, down: 0 };
      entry[row.vote] = Number(row.count);
      tally[row.category] = entry;
    }
    return tally;
  }
}

export function getFeedbackStore(): FeedbackStore {
  return new FeedbackStore(getPool());
}
