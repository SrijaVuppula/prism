// Shared Postgres connection pool. A single pool is reused across the
// process rather than opening a new connection per request.

import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing required environment variable: DATABASE_URL");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
