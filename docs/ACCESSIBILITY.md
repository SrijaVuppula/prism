# Accessibility

## Target: WCAG 2.2 AA (Ring Partner API guideline requirement)

### Checklist

- [x] Screen-reader-compatible markup on the context card (semantic HTML, ARIA labels where needed) — built in from the start: `apps/prism-companion-web/src/components/ContextCard.tsx` uses a `<time>` element, a real `alt` description on the snapshot image, and marks the newest card `aria-live="assertive"` so a new alert is announced as it arrives, not just when the page happens to be read
- [x] No information conveyed by color alone (Signal Class also shown as text/icon) — `SignalBadge.tsx` always pairs an icon and the class name as text
- [x] Focus indicators visible on all interactive elements — `:focus-visible` outline in `App.css`, applied globally rather than per-component
- [x] Motion/vibration patterns don't rely solely on timing precision a user must catch — patterns are on/off pulses meant to be felt, not measured; see the table below
- [x] Feedback and known-visitor-tagging controls follow the same icon+text and semantic-markup conventions as the rest of the app — `FeedbackButtons.tsx` pairs an icon with text and exposes vote state via `aria-pressed`; `TagVisitorControl.tsx` is a real `<form>`/`<label>`/`<input>`, not a browser `prompt()`
- [ ] Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components (context card, Signal Class badge) — dark theme picked for contrast but not measured against the AA thresholds yet
- [ ] All interactive elements reachable and operable via keyboard alone — native `<button>` elements throughout, but not manually walked end to end yet
- [ ] Automated axe-core pass with zero critical/serious violations — not run yet; no axe-core dependency has been added to the companion app
- [ ] Manual screen-reader pass (VoiceOver or NVDA) on the full alert flow

## Vibration pattern specs (Web Vibration API)

| Signal Class | Pattern (ms, on/off pairs) | Rationale |
| --- | --- | --- |
| Routine | `[100]` | Single short pulse — present, not demanding |
| Notable | `[150, 100, 150]` | Two-beat pattern — noticeably distinct from Routine |
| Urgent | `[300, 150, 300, 150, 300]` | Long-pause-long, repeated — unmistakable from the other two |

_(keep this table in sync with `channels/haptic.ts` as the patterns are tuned)_

The companion app never re-implements these patterns: `useVibration.ts` calls
`encodeHapticPattern(signalClass)` from `prism-alert-engine` directly and
passes the result straight to `navigator.vibrate()`. Browsers without
Vibration API support (notably iOS Safari) silently skip it — the visual
context card and push notification still carry the alert there.

## Known-visitor tagging — privacy note

Opt-in only, disclosed clearly in the README, local-only storage — never uploaded or shared.

Implementation: off by default (`user_preferences.known_visitor_tagging_enabled`). The companion app's Settings panel (`SettingsPanel.tsx`) states the disclosure above inline next to the toggle. Tags (`known_visitor_tags`) live only in this household's own Postgres database; nothing about a tagged visitor is sent anywhere else, and no cloud recognition service is involved -- matching is pgvector similarity search against this household's own recent events. `POST /visitors/:visitorGroupId/tag` refuses to tag anything (403) while the preference is off, so tagging can't happen without having gone through the disclosure first.
