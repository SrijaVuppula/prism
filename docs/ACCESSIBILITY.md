# Accessibility

## Target: WCAG 2.2 AA (Ring Partner API guideline requirement)

### What's in place

- Screen-reader-compatible markup on the context card (semantic HTML, ARIA labels where needed) - built in from the start: `apps/prism-companion-web/src/components/ContextCard.tsx` uses a `<time>` element, a real `alt` description on the snapshot image, and marks the newest card `aria-live="assertive"` so a new alert is announced as it arrives, not just when the page happens to be read
- No information conveyed by color alone (Signal Class also shown as text/icon) - `SignalBadge.tsx` always pairs an icon and the class name as text
- Focus indicators visible on all interactive elements - `:focus-visible` outline in `App.css`, applied globally rather than per-component
- Motion/vibration patterns don't rely solely on timing precision a user must catch - patterns are on/off pulses meant to be felt, not measured; see the table below
- Feedback and known-visitor-tagging controls follow the same icon+text and semantic-markup conventions as the rest of the app - `FeedbackButtons.tsx` pairs an icon with text and exposes vote state via `aria-pressed`; `TagVisitorControl.tsx` is a real `<form>`/`<label>`/`<input>`, not a browser `prompt()`
- Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components (context card, Signal Class badge) - measured directly from the palette in `App.css` against the WCAG relative-luminance formula (`apps/prism-companion-web/tests/a11y/colorContrast.test.ts`); every text/background and UI-component/background pair in use clears its threshold (6.7:1-17.9:1 for text, including Signal Class badge text on its tinted fill; 3.1:1-3.6:1 for button and input outlines; 8.9:1+ for the accent fills and 12.8:1+ for the focus ring). `--border` (the card/panel outline) measures 1.3-1.5:1 against its background, below the 3:1 non-text threshold, but it's a decorative divider, not something a user needs to perceive to understand card boundaries or content - spacing and the card's own text carry that - so it's left as is
- Score and delivery details are available as text, not only as graphics - the Signal Score meter (`SignalMeter.tsx`) is a native ARIA `meter` whose value text includes the class ("79 out of 100, Urgent"); the vibration-pattern drawing (`HapticPattern.tsx`) is an `img` with a text description of its pulses; the delivered channels (`DeliveryChannels.tsx`) say "sent" or "not sent" in text. These sit beside the live card (`AlertDetails.tsx`) rather than inside it, so new-alert announcements stay short
- The new-alert glow is a fade, not a flash - the latest-alert panel fades a colored outline twice over about 3.6 seconds when an alert arrives (far below the three-flashes-per-second limit), and it and the "Live" status pulse are switched off under `prefers-reduced-motion`
- Legible type - body text is set in Atkinson Hyperlegible Next, designed by the Braille Institute for low-vision readers; fonts are bundled with the app, so they also work offline and make no third-party requests
- All interactive elements reachable and operable via keyboard alone - verified with a real keyboard-only walk (`apps/prism-companion-web/tests/pages/HomePage.test.tsx`: tabs through every enabled interactive element on the page, in DOM order, asserting no element is skipped and no trap occurs) in addition to the native `<button>`/`<input>`/`<label>` markup throughout
- Automated axe-core pass with zero violations - `axe-core` runs against every component and page state (empty, live alert, history, Settings open, visitor-tagging form, error states) in `apps/prism-companion-web/tests/**/*.test.tsx`, part of `npm run test`; zero violations across all states (color-contrast excluded from this pass since jsdom's computed styles aren't reliable for it - see the dedicated contrast test above)
- Catch-up answers are plain text written for reading at a glance or on a braille display: short sentences, the direct answer first, no markdown, symbols or tables (the agent's instructions in `prism-backend/src/summary/catchUpAgent.ts`). The answer area is a polite live region, so it's announced when it arrives without interrupting a new alert, and alerts loaded from history on opening the app don't vibrate
- Manual screen-reader pass on the full alert flow - performed by hand in October 2026 with VoiceOver on macOS in Safari, on the running app, starting from an empty history. All ten checks passed:
  1. Headings: "Prism" (level 1), then "Latest alert", "Catch up", "Recent activity", "How alerts are delivered" and "Earlier" (level 2), reachable with VoiceOver's heading navigation
  2. The empty state reads "Waiting for the first alert…" and the three Signal Classes with their channels
  3. A new alert is announced on its own when it arrives, without moving focus: Signal Class, what the camera saw, and the time
  4. The alert details read in order: the snapshot's description, Signal Class, device, the Signal Score meter ("65 out of 100, Notable"), each score factor, the vibration pattern as text, and which channels were sent
  5. The feedback buttons announce as toggle buttons and report their pressed state
  6. An Urgent alert is announced as it arrives
  7. Catch up: "Checking your alerts…", then the answer is read on its own; the question field is announced with its label
  8. Settings: every section is announced as a named group, every control has a label, and saving announces "Saved."
  9. Your data: the delete confirmation moves focus to Cancel with the question read, Cancel returns focus to the delete button, and a completed delete announces "Alert history deleted."
  10. Keyboard only, with VoiceOver off: every control is reachable with Tab and Shift+Tab in a sensible order, with a visible focus outline and no trap

## Vibration and sound

| Signal Class | Vibration pattern (ms, on/off) | Sound | Rationale |
| --- | --- | --- | --- |
| Routine | None | None | Visual card only: present, not demanding |
| Notable | `[150, 100, 150]` | Two tones at 523 Hz | Two-beat pattern, noticeably distinct from Urgent |
| Urgent | `[300, 150, 300, 150, 300]` | Three tones at 392 Hz | Long-pause-long, repeated: unmistakable |

The patterns come from `encodeHapticPattern()` in `prism-alert-engine`
(`channels/haptic.ts`), with any per-class override the household sets in
Settings. The backend sends a pattern only with Notable and Urgent alerts,
and the companion app passes it straight to `navigator.vibrate()`
(`useVibration.ts`). Browsers without the Vibration API (notably iOS Safari
and desktop browsers) skip it; the visual card and push notification still
carry the alert there.

The sound follows the same pattern (`useAlertSound.ts`, `lib/alertSound.ts`):
one tone for each pulse, so it has the same rhythm as the vibration and
can be heard on a device that can't vibrate. The tones are generated with
the Web Audio API and are low-pitched, since high frequencies are usually
the first to go with hearing loss, with Urgent lower than Notable. Sound is
a setting for each device ("Play alert sounds" in Settings, on by default,
kept in that browser), since a kitchen laptop and a phone by the bed may
need different choices. Like vibration, only alerts that arrive while the
app is open make a sound, not ones loaded from history. Browsers only allow
sound after the person has interacted with the page, so the app starts its
audio on the first tap or key press; an alert that arrives before then is
silent.

## Known-visitor tagging - privacy note

Opt-in only, disclosed clearly in the README, local-only storage - never uploaded or shared.

Implementation: off by default (`user_preferences.known_visitor_tagging_enabled`). The companion app's Settings panel (`SettingsPanel.tsx`) states the disclosure above inline next to the toggle. Tags (`known_visitor_tags`) live only in this household's own Postgres database; nothing about a tagged visitor is sent anywhere else, and no cloud recognition service is involved - matching is pgvector similarity search against this household's own recent events. `POST /visitors/:visitorGroupId/tag` refuses to tag anything (403) while the preference is off, so tagging can't happen without having gone through the disclosure first.
