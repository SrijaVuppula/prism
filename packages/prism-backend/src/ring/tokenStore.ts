// Postgres-backed storage for Ring OAuth tokens, keyed by Ring Account ID
// (ring_account_links, migration 0011). Ring releases a token pair before
// the user has signed in to Prism, so a pair starts out 'unclaimed' and is
// marked 'linked' once account linking matches it (see accountLinking.ts).

import type { Pool } from "pg";
import { getPool } from "../db/pool";
import { refreshTokens, type RingTokens } from "./oauth";

// Refresh a bit before actual expiry so a request never races an
// about-to-expire token.
const REFRESH_SKEW_MS = 60_000;

export type RingLinkStatus = "unclaimed" | "linked";

export interface RingAccountTokens extends RingTokens {
  accountId: string;
  status: RingLinkStatus;
}

interface RingAccountRow {
  account_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  status: RingLinkStatus;
}

function fromRow(row: RingAccountRow): RingAccountTokens {
  return {
    accountId: row.account_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at.getTime(),
    status: row.status,
  };
}

const COLUMNS = "account_id, access_token, refresh_token, expires_at, status";

export class RingTokenStore {
  constructor(
    private readonly pool: Pool,
    private readonly refresh: (refreshToken: string) => Promise<RingTokens> = refreshTokens,
  ) {}

  /**
   * Stores a newly exchanged token pair as unclaimed. A Ring user who
   * reinstalls the app gets a new pair, which replaces the old one and has
   * to be linked again.
   */
  async saveUnclaimed(accountId: string, tokens: RingTokens): Promise<void> {
    await this.pool.query(
      `INSERT INTO ring_account_links (account_id, access_token, refresh_token, expires_at, status, received_at, linked_at, updated_at)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), 'unclaimed', now(), NULL, now())
       ON CONFLICT (account_id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         status = 'unclaimed',
         received_at = now(),
         linked_at = NULL,
         updated_at = now()`,
      [accountId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
    );
  }

  async listUnclaimed(): Promise<RingAccountTokens[]> {
    const result = await this.pool.query<RingAccountRow>(
      `SELECT ${COLUMNS} FROM ring_account_links WHERE status = 'unclaimed' ORDER BY received_at DESC`,
    );
    return result.rows.map(fromRow);
  }

  async markLinked(accountId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ring_account_links SET status = 'linked', linked_at = now(), updated_at = now() WHERE account_id = $1`,
      [accountId],
    );
  }

  async get(accountId: string): Promise<RingAccountTokens | null> {
    const result = await this.pool.query<RingAccountRow>(`SELECT ${COLUMNS} FROM ring_account_links WHERE account_id = $1`, [
      accountId,
    ]);
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  /** The most recently linked account, for calls that aren't about a specific one (e.g. listing devices). */
  async getLatestLinked(): Promise<RingAccountTokens | null> {
    const result = await this.pool.query<RingAccountRow>(
      `SELECT ${COLUMNS} FROM ring_account_links WHERE status = 'linked' ORDER BY linked_at DESC LIMIT 1`,
    );
    return result.rows[0] ? fromRow(result.rows[0]) : null;
  }

  async delete(accountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ring_account_links WHERE account_id = $1`, [accountId]);
  }

  /**
   * A currently valid access token for the account, refreshing (and storing
   * the new pair) first if the stored one has expired or is about to.
   */
  async getValidAccessToken(account: RingAccountTokens): Promise<string> {
    if (account.expiresAt - Date.now() > REFRESH_SKEW_MS) {
      return account.accessToken;
    }
    const refreshed = await this.refresh(account.refreshToken);
    await this.pool.query(
      `UPDATE ring_account_links
       SET access_token = $2, refresh_token = $3, expires_at = to_timestamp($4 / 1000.0), updated_at = now()
       WHERE account_id = $1`,
      [account.accountId, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt],
    );
    return refreshed.accessToken;
  }
}

export function getRingTokenStore(): RingTokenStore {
  return new RingTokenStore(getPool());
}
