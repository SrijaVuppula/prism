// "Send a test visitor": asks the backend to send the next simulated
// doorbell event (prism-backend/src/demo/routes.ts) through the same path
// as a Ring webhook, so a new household - or anyone trying Prism - can
// see and feel each kind of alert without waiting for a real visitor.

import { useState } from "react";
import { resolveApiBase } from "../lib/apiBase";

export function TestVisitorButton() {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");

  async function send() {
    setSending(true);
    setStatus("");
    try {
      const response = await fetch(`${resolveApiBase()}/test-visitor`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { label?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Couldn't send a test visitor (${response.status}).`);
      setStatus(`Sent a test ${body.label ?? "visitor"}. The alert appears in a few seconds.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Couldn't send a test visitor.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="test-visitor">
      <button type="button" onClick={() => void send()} disabled={sending}>
        <span aria-hidden="true" className="button__icon">
          🔔
        </span>
        {sending ? "Sending…" : "Send a test visitor"}
      </button>
      <p className="test-visitor__status" role="status">
        {status}
      </p>
    </div>
  );
}
