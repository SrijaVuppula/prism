// Opt-in "tag this visitor" control (docs/ACCESSIBILITY.md's known-visitor
// tagging privacy note: opt-in only, disclosed clearly). Only rendered by
// ContextCard when the household has turned known-visitor tagging on in
// Settings -- see SettingsPanel.tsx -- and the event carries a
// visitorGroupId (repeat-visitor memory has run for it). An inline text
// input rather than a browser prompt(), so the label entry is reachable and
// readable the same way the rest of the app is.

import { useState } from "react";
import { resolveApiBase } from "../lib/apiBase";

export interface TagVisitorControlProps {
  visitorGroupId: string;
}

export function TagVisitorControl({ visitorGroupId }: TagVisitorControlProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  if (status === "saved") {
    return (
      <p className="tag-visitor__status" role="status">
        Tagged as "{label}".
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="tag-visitor__open" onClick={() => setOpen(true)}>
        Recognize this visitor
      </button>
    );
  }

  return (
    <form
      className="tag-visitor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim()) return;
        setStatus("saving");
        try {
          const response = await fetch(`${resolveApiBase()}/visitors/${encodeURIComponent(visitorGroupId)}/tag`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: label.trim() }),
          });
          if (!response.ok) throw new Error(`Failed to tag visitor (${response.status})`);
          setStatus("saved");
        } catch (err) {
          console.error("[visitors] failed to tag:", err);
          setStatus("error");
        }
      }}
    >
      <label htmlFor={`tag-visitor-label-${visitorGroupId}`}>Who is this?</label>
      <input
        id={`tag-visitor-label-${visitorGroupId}`}
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="e.g. Mail carrier"
        autoFocus
      />
      <button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save"}
      </button>
      {status === "error" && (
        <p className="tag-visitor__status tag-visitor__status--error" role="alert">
          Couldn't save that tag. Try again.
        </p>
      )}
    </form>
  );
}
