// Storage for opt-in known-visitor tags (docs/ACCESSIBILITY.md's
// "Known-visitor tagging -- privacy note": opt-in only, disclosed clearly,
// local-only -- this table lives in the household's own Postgres and is
// never uploaded or shared anywhere else).
//
// A tag is keyed on visitor_group_id, the stable cluster id repeat-visitor
// memory assigns to a run of visually-similar events (see
// ../db/vectorStore.ts) -- tagging one event as "Mail carrier" tags every
// event pgvector has grouped with it, past and future, not just that one
// snapshot.

import type { Pool } from "pg";
import { getPool } from "./pool";

export interface KnownVisitorTag {
  visitorGroupId: string;
  label: string;
}

export class KnownVisitorTagStore {
  constructor(private readonly pool: Pool) {}

  async tag(visitorGroupId: string, label: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO known_visitor_tags (visitor_group_id, label, tagged_at)
       VALUES ($1, $2, now())
       ON CONFLICT (visitor_group_id) DO UPDATE SET
         label = EXCLUDED.label,
         tagged_at = now()`,
      [visitorGroupId, label],
    );
  }

  async remove(visitorGroupId: string): Promise<void> {
    await this.pool.query(`DELETE FROM known_visitor_tags WHERE visitor_group_id = $1`, [visitorGroupId]);
  }

  async find(visitorGroupId: string): Promise<KnownVisitorTag | null> {
    const result = await this.pool.query<{ visitor_group_id: string; label: string }>(
      `SELECT visitor_group_id, label FROM known_visitor_tags WHERE visitor_group_id = $1`,
      [visitorGroupId],
    );
    const row = result.rows[0];
    return row ? { visitorGroupId: row.visitor_group_id, label: row.label } : null;
  }
}

export function getKnownVisitorTagStore(): KnownVisitorTagStore {
  return new KnownVisitorTagStore(getPool());
}
