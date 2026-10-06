import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMigrationFiles, MigrationError, MIGRATIONS_DIR, runMigrations } from "../../src/db/migrate";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prism-migrations-"));
  writeFileSync(path.join(dir, "0002_second.sql"), "CREATE TABLE second (id INT);");
  writeFileSync(path.join(dir, "0001_first.sql"), "CREATE TABLE first (id INT);");
  writeFileSync(path.join(dir, "0003_third.sql"), "CREATE TABLE third (id INT);");
  writeFileSync(path.join(dir, "README.md"), "not a migration");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A pg client whose query() records every call. `appliedNames` is what the
 * schema_migrations SELECT returns; `failOn` makes the query whose SQL
 * contains that text reject.
 */
function fakePool({ appliedNames = [] as string[], failOn }: { appliedNames?: string[]; failOn?: string } = {}) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (failOn && sql.includes(failOn)) throw new Error("syntax error");
      if (sql.startsWith("SELECT name FROM schema_migrations")) {
        return { rows: appliedNames.map((name) => ({ name })) };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn().mockResolvedValue(client) } as any;
  return { pool, client };
}

function sqlCalls(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
}

describe("listMigrationFiles", () => {
  it("returns only .sql files, in filename order", async () => {
    expect(await listMigrationFiles(dir)).toEqual(["0001_first.sql", "0002_second.sql", "0003_third.sql"]);
  });

  it("finds the backend's own migrations by default", async () => {
    const files = await listMigrationFiles();
    expect(MIGRATIONS_DIR).toBe(path.resolve(__dirname, "..", "..", "src", "db", "migrations"));
    expect(files[0]).toBe("0001_extensions.sql");
    expect(files.length).toBeGreaterThanOrEqual(8);
  });
});

describe("runMigrations", () => {
  it("applies every migration in order, each in its own recorded transaction", async () => {
    const { pool, client } = fakePool();

    const applied = await runMigrations(pool, dir);

    expect(applied).toEqual(["0001_first.sql", "0002_second.sql", "0003_third.sql"]);
    const calls = sqlCalls(client);
    expect(calls[0]).toMatch(/^SELECT pg_advisory_lock/);
    expect(calls[1]).toMatch(/^CREATE TABLE IF NOT EXISTS schema_migrations/);
    expect(calls.slice(3, 7)).toEqual([
      "BEGIN",
      "CREATE TABLE first (id INT);",
      "INSERT INTO schema_migrations (name) VALUES ($1)",
      "COMMIT",
    ]);
    expect(client.query).toHaveBeenCalledWith("INSERT INTO schema_migrations (name) VALUES ($1)", ["0003_third.sql"]);
    expect(calls.at(-1)).toMatch(/^SELECT pg_advisory_unlock/);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("skips migrations already recorded in schema_migrations", async () => {
    const { pool, client } = fakePool({ appliedNames: ["0001_first.sql", "0002_second.sql"] });

    const applied = await runMigrations(pool, dir);

    expect(applied).toEqual(["0003_third.sql"]);
    const calls = sqlCalls(client);
    expect(calls).not.toContain("CREATE TABLE first (id INT);");
    expect(calls).not.toContain("CREATE TABLE second (id INT);");
    expect(calls).toContain("CREATE TABLE third (id INT);");
  });

  it("returns an empty list when the database is up to date", async () => {
    const { pool } = fakePool({ appliedNames: ["0001_first.sql", "0002_second.sql", "0003_third.sql"] });

    expect(await runMigrations(pool, dir)).toEqual([]);
  });

  it("rolls back the failing migration, stops, and still unlocks and releases", async () => {
    const { pool, client } = fakePool({ failOn: "CREATE TABLE second" });

    const error = await runMigrations(pool, dir).catch((err) => err);

    expect(error).toBeInstanceOf(MigrationError);
    expect(error.migration).toBe("0002_second.sql");
    const calls = sqlCalls(client);
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("CREATE TABLE third (id INT);");
    expect(client.query).not.toHaveBeenCalledWith("INSERT INTO schema_migrations (name) VALUES ($1)", [
      "0002_second.sql",
    ]);
    expect(calls.at(-1)).toMatch(/^SELECT pg_advisory_unlock/);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
