// Sends forged Ring webhooks to a Prism server and reports what it answered,
// to show that only webhooks signed with the app's own signing key get in
// (see ring/webhookHandler.ts). Each forgery is a well-formed doorbell press
// from the event simulator, sent once with no X-Signature header and once
// signed with a random key, so nothing here needs the server's secret.
// Used by `npm run forged-webhooks` (scripts/send-forged-webhooks.ts).

import { createHmac, randomBytes } from "node:crypto";
import { buildSimulatedWebhook, SAMPLE_EVENTS } from "./testVisitors";

export interface ForgedWebhookResult {
  attempt: string;
  status: number;
  body: string;
  rejected: boolean;
}

interface Attempt {
  attempt: string;
  headers: Record<string, string>;
}

function attempts(body: string): Attempt[] {
  const wrongKey = randomBytes(32);
  return [
    { attempt: "no X-Signature header", headers: {} },
    {
      attempt: "signed with a key that isn't the server's",
      headers: { "X-Signature": `sha256=${createHmac("sha256", wrongKey).update(body).digest("hex")}` },
    },
  ];
}

/** Sends each forgery to `targetUrl` (a server's POST /webhooks/ring). Rejected means the server answered 401. */
export async function sendForgedWebhooks(targetUrl: string, fetchImpl: typeof fetch = fetch): Promise<ForgedWebhookResult[]> {
  const body = JSON.stringify(buildSimulatedWebhook(SAMPLE_EVENTS[0], new Date()));
  const results: ForgedWebhookResult[] = [];
  for (const { attempt, headers } of attempts(body)) {
    const response = await fetchImpl(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
    results.push({ attempt, status: response.status, body: await response.text(), rejected: response.status === 401 });
  }
  return results;
}
