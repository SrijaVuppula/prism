// A short note at the top of a public demo deployment, saying what the
// visitor is looking at and what to press. Shown only in a build made with
// VITE_DEMO_NOTE=1 (see infra/aws/demo); a household's own app never shows it.

export function isDemoNoteEnabled(): boolean {
  return import.meta.env.VITE_DEMO_NOTE === "1";
}

export function DemoNote() {
  return (
    <div className="demo-note" role="note" aria-label="About this demo">
      <p>
        <strong>This is a live demo</strong> with simulated Ring events. Press <strong>Send a test visitor</strong> to
        watch an alert arrive, then press <strong>What did I miss?</strong> under Catch up.
      </p>
      <p>Everyone trying the demo shares one household, so you may also see other people's test visitors.</p>
    </div>
  );
}
