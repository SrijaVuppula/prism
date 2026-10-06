import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "dotenv";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fillBlankValues, initEnvFile, PLACEHOLDER_VAPID_SUBJECT } from "../src/initEnv";

let dir: string;
let envPath: string;
let examplePath: string;

const generators = {
  webhookSecret: vi.fn(() => "generated-secret"),
  vapidKeys: vi.fn(() => ({ publicKey: "generated-public", privateKey: "generated-private" })),
};

const EXAMPLE = [
  "# Shared secret Ring signs webhook payloads with (HMAC-SHA256).",
  "RING_WEBHOOK_SECRET=",
  "BEDROCK_REGION=us-east-2",
  "BEDROCK_MODEL_ID=model-id",
  "BEDROCK_EMBEDDING_MODEL_ID=embedding-model-id",
  "DATABASE_URL=postgres://prism:prism@localhost:5432/prism",
  "VAPID_PUBLIC_KEY=",
  "VAPID_PRIVATE_KEY=",
  "VAPID_SUBJECT=",
  "",
].join("\n");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "prism-init-env-"));
  envPath = path.join(dir, ".env");
  examplePath = path.join(dir, ".env.example");
  writeFileSync(examplePath, EXAMPLE);
  generators.webhookSecret.mockClear();
  generators.vapidKeys.mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fillBlankValues", () => {
  it("fills empty values, leaves set ones alone, and appends missing keys before the trailing newline", () => {
    const { content, filled } = fillBlankValues("# comment\nA=\nB=kept\n", { A: "1", B: "2", C: "3" });

    expect(content).toBe("# comment\nA=1\nB=kept\nC=3\n");
    expect(filled).toEqual(["A", "C"]);
  });
});

describe("initEnvFile", () => {
  it("creates .env from the example and fills the generated values", () => {
    const result = initEnvFile(envPath, examplePath, generators);

    expect(result.created).toBe(true);
    expect(result.filled).toEqual(["RING_WEBHOOK_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(result.missing).toEqual([]);
    const env = parse(readFileSync(envPath, "utf8"));
    expect(env).toMatchObject({
      RING_WEBHOOK_SECRET: "generated-secret",
      VAPID_PUBLIC_KEY: "generated-public",
      VAPID_PRIVATE_KEY: "generated-private",
      VAPID_SUBJECT: PLACEHOLDER_VAPID_SUBJECT,
      BEDROCK_REGION: "us-east-2",
    });
    expect(readFileSync(envPath, "utf8")).toContain("# Shared secret Ring signs webhook payloads with");
  });

  it("never changes values already set in an existing .env", () => {
    writeFileSync(
      envPath,
      "RING_WEBHOOK_SECRET=mine\nVAPID_PUBLIC_KEY=my-public\nVAPID_PRIVATE_KEY=my-private\nVAPID_SUBJECT=mailto:me@example.org\nDATABASE_URL=postgres://x\nBEDROCK_REGION=us-east-2\nBEDROCK_MODEL_ID=m\nBEDROCK_EMBEDDING_MODEL_ID=e\n",
    );
    const before = readFileSync(envPath, "utf8");

    const result = initEnvFile(envPath, examplePath, generators);

    expect(result).toEqual({ created: false, filled: [], missing: [], warnings: [] });
    expect(readFileSync(envPath, "utf8")).toBe(before);
    expect(generators.webhookSecret).not.toHaveBeenCalled();
    expect(generators.vapidKeys).not.toHaveBeenCalled();
  });

  it("fills only the blanks in an existing .env and reports what the user still has to set", () => {
    writeFileSync(envPath, "RING_WEBHOOK_SECRET=mine\nBEDROCK_REGION=\nDATABASE_URL=postgres://x\n");

    const result = initEnvFile(envPath, examplePath, generators);

    expect(result.created).toBe(false);
    expect(result.filled).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(result.missing).toEqual(["BEDROCK_REGION", "BEDROCK_MODEL_ID", "BEDROCK_EMBEDDING_MODEL_ID"]);
    expect(parse(readFileSync(envPath, "utf8")).RING_WEBHOOK_SECRET).toBe("mine");
  });

  it("won't generate half a VAPID key pair", () => {
    writeFileSync(envPath, "VAPID_PUBLIC_KEY=my-public\nVAPID_PRIVATE_KEY=\n");

    const result = initEnvFile(envPath, examplePath, generators);

    expect(generators.vapidKeys).not.toHaveBeenCalled();
    expect(result.filled).not.toContain("VAPID_PRIVATE_KEY");
    expect(result.warnings.join(" ")).toMatch(/Only one of VAPID_PUBLIC_KEY/);
  });

  it("doesn't create a file when there is no example to copy", () => {
    rmSync(examplePath);

    expect(() => initEnvFile(envPath, examplePath, generators)).toThrow();
    expect(existsSync(envPath)).toBe(false);
  });
});
