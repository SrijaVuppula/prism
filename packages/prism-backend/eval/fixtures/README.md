# Fixture images

Each entry in `../dataset.ts` expects an image at `fixtures/<id>.jpg` -- see
that entry's `notes` for what it should show. No images are checked in.

Before running `npm run eval` (from `packages/prism-backend`), populate this
folder with one JPEG per dataset entry, named to match (e.g.
`person-front-door-daylight.jpg`). Real Ring snapshots you've saved locally
work best; representative stock photos are fine too as long as the subject
matches the entry's notes.

Entries with no matching file are reported as errors in the eval output
rather than silently skipped.
