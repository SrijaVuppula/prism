# Fixture images

One JPEG per entry in `../dataset.ts`, named `<id>.jpg` -- see that entry's
`notes` for what it should show. They're used by `npm run eval` (from
`packages/prism-backend`) and as the snapshots the local event simulator
sends (`npm run seed` from the repository root).

To add an entry, add it to `../dataset.ts` and put a matching image here.
Real Ring snapshots work best; representative stock photos are fine too as
long as the subject matches the entry's notes.

Entries with no matching file are reported as errors in the eval output
rather than silently skipped.
