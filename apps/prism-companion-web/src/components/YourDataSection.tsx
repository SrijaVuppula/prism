// "Your data" in Settings: what Prism stores, how long it keeps it, and a
// way to delete the alert history (prism-backend/src/data/routes.ts). It
// sits outside the preferences form because deleting takes effect right
// away, after a confirmation step, rather than on "Save settings". See
// docs/PRIVACY.md.

import { useEffect, useRef, useState } from "react";
import { resolveApiBase } from "../lib/apiBase";

interface DataSummary {
  retentionDays: number;
  storedAlerts: number;
}

type DeleteState = "idle" | "confirming" | "deleting" | "deleted" | "error";

function alertCount(count: number): string {
  return `${count} ${count === 1 ? "alert" : "alerts"}`;
}

export function YourDataSection({ onHistoryDeleted }: { onHistoryDeleted?: () => void }) {
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [state, setState] = useState<DeleteState>("idle");
  const deleteButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${resolveApiBase()}/data`);
        if (!response.ok) throw new Error(`Failed to load data summary (${response.status})`);
        const data = (await response.json()) as Partial<DataSummary>;
        if (typeof data.retentionDays !== "number" || typeof data.storedAlerts !== "number") {
          throw new Error("Unexpected data summary");
        }
        if (!cancelled) setSummary({ retentionDays: data.retentionDays, storedAlerts: data.storedAlerts });
      } catch (err) {
        console.error("[data] failed to load summary:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus follows the step: the safe choice when asked to confirm, and back
  // to the delete button once the question is gone.
  useEffect(() => {
    if (state === "confirming") cancelButton.current?.focus();
    if (state === "deleted" || state === "error") deleteButton.current?.focus();
  }, [state]);

  async function deleteHistory() {
    setState("deleting");
    try {
      const response = await fetch(`${resolveApiBase()}/data/history`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Failed to delete history (${response.status})`);
      setSummary((previous) => (previous ? { ...previous, storedAlerts: 0 } : previous));
      setState("deleted");
      onHistoryDeleted?.();
    } catch (err) {
      console.error("[data] failed to delete history:", err);
      setState("error");
    }
  }

  const days = summary ? `${summary.retentionDays} days` : "a limited time";

  return (
    <section className="settings-panel__section your-data" aria-labelledby="your-data-title">
      <h3 id="your-data-title" className="your-data__title">
        Your data
      </h3>
      <p className="settings-panel__disclosure">
        Prism keeps each alert, the description of what the camera saw, repeat-visitor memory, your thumbs up and
        down votes, and any visitor tags on this household's own Prism server for {days}, then deletes them
        automatically.
      </p>
      <p className="settings-panel__disclosure">
        Snapshots aren't saved. Prism gets them from Ring when it needs them, with your Ring privacy zones blacked
        out, and sends them to Amazon Bedrock to be described. Bedrock doesn't store them or use them to train
        models.
      </p>
      {summary && <p className="settings-panel__hint">Stored now: {alertCount(summary.storedAlerts)}.</p>}

      {state === "confirming" || state === "deleting" ? (
        <div className="your-data__confirm" role="group" aria-labelledby="your-data-confirm">
          <p id="your-data-confirm">
            Delete {summary ? `all ${alertCount(summary.storedAlerts)}` : "every stored alert"}, with visitor memory,
            votes and visitor tags? This can't be undone. Your settings and Ring connection are kept.
          </p>
          <div className="your-data__actions">
            <button
              type="button"
              className="button--danger"
              onClick={() => void deleteHistory()}
              disabled={state === "deleting"}
            >
              {state === "deleting" ? "Deleting…" : "Delete permanently"}
            </button>
            <button ref={cancelButton} type="button" onClick={() => setState("idle")} disabled={state === "deleting"}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={deleteButton}
          type="button"
          className="button--danger your-data__delete"
          onClick={() => setState("confirming")}
        >
          Delete alert history
        </button>
      )}

      <p className="settings-panel__save-status" role="status">
        {state === "deleted" && "Alert history deleted."}
        {state === "error" && "Couldn't delete the alert history. Please try again."}
      </p>
      <p className="settings-panel__hint">
        To disconnect Ring, remove Prism in the Ring app. Prism then deletes its Ring sign-in tokens.
      </p>
    </section>
  );
}
