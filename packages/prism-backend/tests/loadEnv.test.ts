import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_FILE_PATH, loadEnv } from "../src/loadEnv";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prism-env-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PRISM_TEST_FROM_FILE;
  delete process.env.PRISM_TEST_ALREADY_SET;
});

describe("loadEnv", () => {
  it("defaults to the .env file at the backend package root", () => {
    expect(ENV_FILE_PATH).toBe(path.resolve(__dirname, "..", ".env"));
  });

  it("loads variables from the file into process.env", () => {
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "PRISM_TEST_FROM_FILE=from-file\n");

    loadEnv(envFile);

    expect(process.env.PRISM_TEST_FROM_FILE).toBe("from-file");
  });

  it("does not override variables already set in the environment", () => {
    const envFile = path.join(dir, ".env");
    writeFileSync(envFile, "PRISM_TEST_ALREADY_SET=from-file\n");
    process.env.PRISM_TEST_ALREADY_SET = "from-environment";

    loadEnv(envFile);

    expect(process.env.PRISM_TEST_ALREADY_SET).toBe("from-environment");
  });

  it("does not throw when the file does not exist", () => {
    expect(() => loadEnv(path.join(dir, "missing.env"))).not.toThrow();
  });
});
