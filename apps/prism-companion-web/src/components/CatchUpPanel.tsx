// "Catch up": asks the backend's catch-up agent (prism-backend/src/summary)
// what happened since the household last had the app open, or answers
// their own question about recent alerts, in a few plain sentences that
// read well at a glance or on a braille display. The answer is announced
// politely when it arrives.

import { useState, type FormEvent } from "react";
import { resolveApiBase } from "../lib/apiBase";

type AskState = "idle" | "asking" | "answered" | "error";

const MAX_QUESTION_LENGTH = 300;

function sinceLabel(since: string | undefined, timeZone: string | undefined): string {
  if (!since) return "Covers the last 24 hours.";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(since));
  return `Covers everything since you last had Prism open (${time}).`;
}

export function CatchUpPanel({ since, timeZone }: { since?: string; timeZone?: string }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>("idle");
  const [answer, setAnswer] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask(text?: string) {
    setState("asking");
    setError(null);
    try {
      const response = await fetch(`${resolveApiBase()}/catch-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(text ? { question: text } : {}), ...(since ? { since } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!response.ok || typeof body.answer !== "string") {
        throw new Error(body.error ?? `The catch-up summary isn't available right now (${response.status}).`);
      }
      setAnswer(body.answer.split(/\n+/).filter((line) => line.trim()));
      setState("answered");
    } catch (err) {
      console.error("[catch-up] failed:", err);
      setError(err instanceof Error ? err.message : "The catch-up summary isn't available right now.");
      setState("error");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (text) void ask(text);
  }

  const asking = state === "asking";

  return (
    <section className="catch-up" aria-labelledby="catch-up-title">
      <h2 id="catch-up-title" className="section-title">
        Catch up
      </h2>
      <button type="button" className="catch-up__missed" onClick={() => void ask()} disabled={asking}>
        What did I miss?
      </button>
      <p className="catch-up__hint">{sinceLabel(since, timeZone)}</p>

      <form className="catch-up__form" onSubmit={onSubmit}>
        <label htmlFor="catch-up-question">Or ask about your alerts</label>
        <div className="catch-up__ask">
          <input
            id="catch-up-question"
            type="text"
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="Did a package come today?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" disabled={asking || !question.trim()}>
            Ask
          </button>
        </div>
      </form>

      <div className="catch-up__answer" aria-live="polite" aria-busy={asking}>
        {asking && <p className="catch-up__status">Checking your alerts…</p>}
        {state === "answered" && answer.map((line, index) => <p key={index}>{line}</p>)}
        {state === "error" && <p className="catch-up__error">{error}</p>}
      </div>
    </section>
  );
}
