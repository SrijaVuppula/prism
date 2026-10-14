// Delivered alerts, kept so the companion app can show recent alerts after
// a reload and the catch-up summary (summary/catchUpAgent.ts) can read them.
// Each row is the exact message the app received over the WebSocket.

import type { Pool } from "pg";
import type { EventCategory, SignalClass } from "prism-alert-engine";
import type { CompanionEventMessage } from "../api/websocket";
import { getPool } from "./pool";

export interface AlertQuery {
  /** Only alerts that happened at or after this time. */
  since?: Date;
  /** Only alerts that happened before this time. */
  until?: Date;
  /** Only alerts delivered at or after this time, whenever they happened. */
  deliveredSince?: Date;
  signalClass?: SignalClass;
  category?: EventCategory;
  /** Most recent first; at most this many. */
  limit: number;
}

export class AlertHistoryStore {
  constructor(private readonly pool: Pool) {}

  async save(message: CompanionEventMessage): Promise<void> {
    const { event } = message;
    if (!event.scoring || !event.classification) return;
    await this.pool.query(
      `INSERT INTO delivered_alerts (event_id, occurred_at, signal_class, category, message)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO UPDATE SET message = EXCLUDED.message, signal_class = EXCLUDED.signal_class,
         category = EXCLUDED.category, delivered_at = now()`,
      [event.id, event.occurredAt, event.scoring.signalClass, event.classification.category, JSON.stringify(message)],
    );
  }

  async list(query: AlertQuery): Promise<CompanionEventMessage[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace("?", `$${params.length}`));
    };
    if (query.since) add("occurred_at >= ?", query.since);
    if (query.until) add("occurred_at < ?", query.until);
    if (query.deliveredSince) add("delivered_at >= ?", query.deliveredSince);
    if (query.signalClass) add("signal_class = ?", query.signalClass);
    if (query.category) add("category = ?", query.category);
    params.push(query.limit);

    const result = await this.pool.query<{ message: CompanionEventMessage }>(
      `SELECT message FROM delivered_alerts
       ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY occurred_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((row) => row.message);
  }
}

export function getAlertHistoryStore(): AlertHistoryStore {
  return new AlertHistoryStore(getPool());
}
