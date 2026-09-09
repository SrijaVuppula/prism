// Postgres-backed storage for linked Ring accounts' OAuth tokens.

import type { Pool } from "pg";
import { getPool } from "../db/pool";
import { refreshTokens, RingTokens } from "./oauth";

// Refresh a bit before actual expiry so a request never races an
// about-to-expire token.
const REFRESH_SKEW_MS = 60_000;

interface RingAccountRow {
  access_token: string;
  refresh_token: string;
  expires_at: Date;
}

export class RingTokenStore {
  constructor(private readonly pool: Pool) {}

  async save(userId: string, tokens: RingTokens): Promise<void> {
    await this.pool.query(
      `INSERT INTO ring_accounts (user_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), now())
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
      [userId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
    );
  }

  async get(userId: string): Promise<RingTokens | null> {
    const result = await this.pool.query<RingAccountRow>(
      `SELECT access_token, refresh_token, expires_at FROM ring_accounts WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at.getTime(),
    };
  }

  async delete(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ring_accounts WHERE user_id = $1`, [userId]);
  }

  /**
   * Returns a currently-valid access token for the user, refreshing (and
   * persisting the refreshed pair) first if the stored token is expired or
   * close to it.
   */
  async getValidAccessToken(userId: string): Promise<string> {
    const tokens = await this.get(userId);
    if (!tokens) {
      throw new Error(`No linked Ring account for user ${userId}`);
    }
    if (tokens.expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return tokens.accessToken;
    }
    const refreshed = await refreshTokens(tokens.refreshToken);
    await this.save(userId, refreshed);
    return refreshed.accessToken;
  }
}

export function getRingTokenStore(): RingTokenStore {
  return new RingTokenStore(getPool());
}
