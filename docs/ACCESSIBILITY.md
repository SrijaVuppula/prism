# Accessibility

## Target: WCAG 2.2 AA (Ring Partner API guideline requirement)

### Checklist

- [x] Screen-reader-compatible markup on the context card (semantic HTML, ARIA labels where needed) — built in from the start: `apps/prism-companion-web/src/components/ContextCard.tsx` uses a `<time>` element, a real `alt` description on the snapshot image, and marks the newest card `aria-live="assertive"` so a new alert is announced as it arrives, not just when the page happens to be read
- [x] No information conveyed by color alone (Signal Class also shown as text/icon) — `SignalBadge.tsx` always pairs an icon and the class name as text
- [x] Focus indicators visible on all interactive elements — `:focus-visible` outline in `App.css`, applied globally rather than per-component
- [x] Motion/vibration patterns don't rely solely on timing precision a user must catch — patterns are on/off pulses meant to be felt, not measured; see the table below
- [x] Feedback and known-visitor-tagging controls follow the same icon+text and semantic-markup conventions as the rest of the app — `FeedbackButtons.tsx` pairs an icon with text and exposes vote state via `aria-pressed`; `TagVisitorControl.tsx` is a real `<form>`/`<label>`/`<input>`, not a browser `prompt()`
- [x] Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components (context card, Signal Class badge) — measured directly from the palette in `App.css` against the WCAG relative-luminance formula (`apps/prism-companion-web/tests/a11y/colorContrast.test.ts`); every text/background and UI-component/background pair in use clears its threshold (6.7:1-17.9:1 for text, including Signal Class badge text on its tinted fill; 3.1:1-3.6:1 for button and input outlines; 8.9:1+ for the accent fills and 12.8:1+ for the focus ring). `--border` (the card/panel outline) measures 1.3-1.5:1 against its background, below the 3:1 non-text threshold, but it's a decorative divider, not something a user needs to perceive to understand card boundaries or content — spacing and the card's own text carry that — so it's left as is
- [x] Score and delivery details are available as text, not only as graphics — the Signal Score meter (`SignalMeter.tsx`) is a native ARIA `meter` whose value text includes the class ("79 out of 100, Urgent"); the vibration-pattern drawing (`HapticPattern.tsx`) is an `img` with a text description of its pulses; the delivered channels (`DeliveryChannels.tsx`) say "sent" or "not sent" in text. These sit beside the live card (`AlertDetails.tsx`) rather than inside it, so new-alert announcements stay short
- [x] The new-alert glow is a fade, not a flash — the latest-alert panel fades a colored outline twice over about 3.6 seconds when an alert arrives (far below the three-flashes-per-second limit), and it and the "Live" status pulse are switched off under `prefers-reduced-motion`
- [x] Legible type — body text is set in Atkinson Hyperlegible Next, designed by the Braille Institute for low-vision readers; fonts are bundled with the app, so they also work offline and make no third-party requests
- [x] All interactive elements reachable and operable via keyboard alone — verified with a real keyboard-only walk (`apps/prism-companion-web/tests/pages/HomePage.test.tsx`: tabs through every enabled interactive element on the page, in DOM order, asserting no element is skipped and no trap occurs) in addition to the native `<button>`/`<input>`/`<label>` markup throughout
- [x] Automated axe-core pass with zero critical/serious violations — `axe-core` runs against every component and page state (empty, live alert, history, Settings open, visitor-tagging form, error states) in `apps/prism-companion-web/tests/**/*.test.tsx`, part of `npm run test`; zero violations across all states (color-contrast excluded from this pass since jsdom's computed styles aren't reliable for it — see the dedicated contrast test above)
- [ ] Manual screen-reader pass (VoiceOver or NVDA) on the full alert flow — not yet performed by a person on the built app; everything short of that (accessible names, roles, live-region behavior, focus order) is covered by the automated pass above, but an actual AT pass is the one item still worth doing by hand before submission

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
