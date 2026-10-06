// Applies the SQL files in db/migrations/ in filename order. Each file runs
// in its own transaction and is recorded in schema_migrations, so running
// this again only applies files added since the last run. A Postgres
// advisory lock is held for the whole run, so two runners started at the
// same time (e.g. a container start and a manual `npm run migrate`) apply
// each file once rather than racing.
//
// Usage: npm run migrate (DATABASE_URL comes from the environment or
// packages/prism-backend/.env)

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { loadEnv } from "../loadEnv";
import { getPool } from "./pool";

/** src/db/migrations -- resolved from the package root so it works from src/ and dist/. */
export const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "src", "db", "migrations");

// Arbitrary constant key for pg_advisory_lock; only has to be unique among
// the advisory locks this database uses.
const MIGRATION_LOCK_KEY = 4_177_210;

export class MigrationError extends Error {
  constructor(
    public readonly migration: string,
    public readonly cause?: unknown,
  ) {
    super(`Migration ${migration} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "MigrationError";
  }
}

/** The .sql files in `dir`, in the order they must be applied. */
export async function listMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Applies every migration in `dir` not yet recorded in schema_migrations
 * and returns the names of the ones it applied (empty when the database is
 * already up to date). Stops at the first failure, rolling that file back.
 */
export async function runMigrations(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = await listMigrationFiles(dir);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const alreadyApplied = new Set(rows.map((row) => row.name));

    const applied: string[] = [];
    for (const name of files) {
      if (alreadyApplied.has(name)) continue;
      const sql = await readFile(path.join(dir, name), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new MigrationError(name, err);
      }
      applied.push(name);
    }
    return applied;
  } finally {
    // The lock is session-scoped, so Postgres drops it anyway if the
    // connection is gone; an unlock failure shouldn't mask the real error.
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const pool = getPool();
  try {
    const applied = await runMigrations(pool);
    console.log(
      applied.length === 0 ? "[migrate] database is up to date" : `[migrate] applied ${applied.join(", ")}`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate] failed:", err);
    process.exitCode = 1;
  });
}
