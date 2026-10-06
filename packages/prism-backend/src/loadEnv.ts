// Loads packages/prism-backend/.env into process.env. Every config module
// reads its variables lazily, at first use, so calling loadEnv() at the top
// of an entry point is enough. Variables already set in the environment win
// over the file, and a missing file is not an error, so a deployment can
// supply its configuration through the environment alone.

import path from "node:path";
import { config } from "dotenv";

/** packages/prism-backend/.env -- resolves the same from src/ and dist/. */
export const ENV_FILE_PATH = path.resolve(__dirname, "..", ".env");

export function loadEnv(envFilePath: string = ENV_FILE_PATH): void {
  config({ path: envFilePath, quiet: true });
}
