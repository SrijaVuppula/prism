// Creates packages/prism-backend/.env from .env.example when it doesn't
// exist yet, then fills in the values that can be generated locally rather
// than issued by someone else: the webhook signing secret shared with the
// event simulator, and a VAPID key pair for Web Push. Values that are
// already set are never changed, and generated values are written only to
// the file, never printed.
//
// Usage: npm run init-env

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import webPush from "web-push";
import { ENV_FILE_PATH } from "./loadEnv";

export const ENV_EXAMPLE_PATH = path.resolve(__dirname, "..", ".env.example");

/** Contact placeholder for VAPID_SUBJECT; push services accept it, but a real address is better. */
export const PLACEHOLDER_VAPID_SUBJECT = "mailto:prism@example.com";

/** Variables the local simulator path needs that can't be generated here. */
const REQUIRED_FROM_USER = ["DATABASE_URL", "BEDROCK_REGION", "BEDROCK_MODEL_ID", "BEDROCK_EMBEDDING_MODEL_ID"];

export interface EnvGenerators {
  webhookSecret(): string;
  vapidKeys(): { publicKey: string; privateKey: string };
}

const defaultGenerators: EnvGenerators = {
  webhookSecret: () => randomBytes(32).toString("hex"),
  vapidKeys: () => webPush.generateVAPIDKeys(),
};

export interface InitEnvResult {
  /** True when the .env file was created from .env.example by this run. */
  created: boolean;
  /** Names of the variables this run filled in. */
  filled: string[];
  /** Required variables that are still empty and need a value from the user. */
  missing: string[];
  warnings: string[];
}

/**
 * Sets every `KEY=` line in `content` whose value is empty to the value
 * given for it in `values`, and appends keys that aren't in `content` at
 * all. Returns the updated content and the keys it filled.
 */
export function fillBlankValues(content: string, values: Record<string, string>): { content: string; filled: string[] } {
  const filled: string[] = [];
  const present = new Set<string>();
  const lines = content.split("\n").map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key, value] = match;
    present.add(key);
    if (key in values && value.trim() === "") {
      filled.push(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  const appended = Object.keys(values)
    .filter((key) => !present.has(key))
    .map((key) => {
      filled.push(key);
      return `${key}=${values[key]}`;
    });
  if (appended.length > 0) {
    // Keep a trailing newline at the end of the file.
    const trailing = lines.at(-1) === "" ? lines.pop() : undefined;
    lines.push(...appended);
    if (trailing !== undefined) lines.push(trailing);
  }

  return { content: lines.join("\n"), filled };
}

export function initEnvFile(
  envPath: string = ENV_FILE_PATH,
  examplePath: string = ENV_EXAMPLE_PATH,
  generators: EnvGenerators = defaultGenerators,
): InitEnvResult {
  const created = !existsSync(envPath);
  const original = created ? readFileSync(examplePath, "utf8") : readFileSync(envPath, "utf8");
  const current = parse(original);
  const warnings: string[] = [];

  const values: Record<string, string> = {};
  if (!current.RING_WEBHOOK_SECRET) {
    values.RING_WEBHOOK_SECRET = generators.webhookSecret();
  }
  if (!current.VAPID_PUBLIC_KEY && !current.VAPID_PRIVATE_KEY) {
    const keys = generators.vapidKeys();
    values.VAPID_PUBLIC_KEY = keys.publicKey;
    values.VAPID_PRIVATE_KEY = keys.privateKey;
  } else if (!current.VAPID_PUBLIC_KEY || !current.VAPID_PRIVATE_KEY) {
    // Generating only the missing half would produce a mismatched pair.
    warnings.push("Only one of VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY is set; clear both to generate a new pair.");
  }
  if (!current.VAPID_SUBJECT) {
    values.VAPID_SUBJECT = PLACEHOLDER_VAPID_SUBJECT;
    warnings.push(`VAPID_SUBJECT was set to ${PLACEHOLDER_VAPID_SUBJECT}; replace it with your own contact address.`);
  }

  const { content, filled } = fillBlankValues(original, values);
  if (created || filled.length > 0) {
    writeFileSync(envPath, content, { mode: 0o600 });
  }

  const updated = parse(content);
  const missing = REQUIRED_FROM_USER.filter((key) => !updated[key]);
  return { created, filled, missing, warnings };
}

function main(): void {
  const result = initEnvFile();
  const relativePath = "packages/prism-backend/.env";
  if (result.created) console.log(`[init-env] created ${relativePath} from .env.example`);
  console.log(
    result.filled.length > 0
      ? `[init-env] filled in: ${result.filled.join(", ")}`
      : "[init-env] nothing to generate; existing values were left as they are",
  );
  for (const warning of result.warnings) console.log(`[init-env] note: ${warning}`);
  if (result.missing.length > 0) {
    console.log(`[init-env] still needs a value in ${relativePath}: ${result.missing.join(", ")}`);
  }
}

if (require.main === module) {
  main();
}
