// Sends forged Ring webhooks - one unsigned, one signed with the wrong key
// - to a Prism server and checks that it rejects both with a 401 before
// anything reaches the alert pipeline. See
// packages/prism-backend/src/demo/forgedWebhooks.ts.
//
// Usage, against a backend running locally (`npm run dev`):
//   npm run forged-webhooks
// or against any deployed Prism server, such as the public demo:
//   SIMULATOR_TARGET_URL=https://<host>/webhooks/ring npm run forged-webhooks
//
// Exits with status 1 if the server accepted any of them.

import { sendForgedWebhooks } from "../packages/prism-backend/src/demo/forgedWebhooks";

async function main() {
  const targetUrl = process.env.SIMULATOR_TARGET_URL ?? "http://localhost:3000/webhooks/ring";
  console.log(`Sending forged Ring webhooks to ${targetUrl}`);
  const results = await sendForgedWebhooks(targetUrl);
  for (const result of results) {
    console.log(`[${result.rejected ? "rejected" : "ACCEPTED"}] ${result.attempt} -> ${result.status} ${result.body}`);
  }
  if (results.every((result) => result.rejected)) {
    console.log("The server rejected every forged webhook.");
  } else {
    console.error("The server accepted a forged webhook.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
