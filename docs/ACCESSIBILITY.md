# Accessibility

## Target: WCAG 2.2 AA (Ring Partner API guideline requirement)

### Checklist (draft — fill in as built, audit with axe-core once the companion app is in place)

- [ ] Color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI components (context card, Signal Class badge)
- [ ] All interactive elements reachable and operable via keyboard alone
- [ ] Screen-reader-compatible markup on the context card (semantic HTML, ARIA labels where needed) — built in from 3.3, not retrofitted
- [ ] Focus indicators visible on all interactive elements
- [ ] No information conveyed by color alone (Signal Class also shown as text/icon)
- [ ] Motion/vibration patterns don't rely solely on timing precision a user must catch
- [ ] Automated axe-core pass with zero critical/serious violations
- [ ] Manual screen-reader pass (VoiceOver or NVDA) on the full alert flow

## Vibration pattern specs (Web Vibration API)

| Signal Class | Pattern (ms, on/off pairs) | Rationale |
| --- | --- | --- |
| Routine | `[100]` | Single short pulse — present, not demanding |
| Notable | `[150, 100, 150]` | Two-beat pattern — noticeably distinct from Routine |
| Urgent | `[300, 150, 300, 150, 300]` | Long-pause-long, repeated — unmistakable from the other two |

_(keep this table in sync with `channels/haptic.ts` as the patterns are tuned)_

## Known-visitor tagging — privacy note

Opt-in only, disclosed clearly in the README, local-only storage — never uploaded or shared.
