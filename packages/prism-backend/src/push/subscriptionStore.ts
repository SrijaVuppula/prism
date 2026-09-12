// Postgres-backed storage for Web Push subscriptions. The companion app has
// no per-user auth yet (same placeholder state as Ring account linking in
// ring/routes.ts), so every stored subscription is treated as one of this
// household's companion devices and receives every alert -- mirroring how
// the WebSocket server broadcasts to every connected client rather than
// targeting a specific user.

import type { Pool } from "pg";
import { getPool } from "../db/pool";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export class PushSubscriptionStore {
  constructor(private readonly pool: Pool) {}

  async save(subscription: PushSubscriptionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth`,
      [subscription.endpoint, subscription.p256dh, subscription.auth],
    );
  }

  async remove(endpoint: string): Promise<void> {
    await this.pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
  }

  async list(): Promise<PushSubscriptionRecord[]> {
    const result = await this.pool.query<PushSubscriptionRow>(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions`,
    );
    return result.rows;
  }
}

export function getPushSubscriptionStore(): PushSubscriptionStore {
  return new PushSubscriptionStore(getPool());
}
