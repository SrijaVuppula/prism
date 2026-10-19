# Ring Appstore readiness

How Prism lines up with what Ring's developer documentation asks of partner
apps before certification, and what's still to do. Ring's review covers
technical, security and policy compliance, including a privacy and legal
questionnaire (general, data processing, AI governance, data protection and
third parties). Checked against Ring's documentation as of October 2026;
see [Sources](#sources).

**Status:** Prism hasn't been submitted for certification, and hasn't yet
been run against a live Ring account. Everything below marked done is
covered by tests and exercised end to end with the event simulator.

## Account linking and endpoints

| Ring asks for | Prism | Status |
| --- | --- | --- |
| OAuth 2.0 one-way account linking: exchange the authorization code at Ring's token endpoint, refresh tokens before they expire | Token exchange within the code's 60-second life, refresh before expiry ([`accountLinking.ts`](../packages/prism-backend/src/ring/accountLinking.ts), [`oauth.ts`](../packages/prism-backend/src/ring/oauth.ts)) | Done |
| The user signs in to the partner service on the Account Link page, and only then is the nonce matched | The household signs in with its link passcode before the nonce is recomputed and matched ([`linkPage.ts`](../packages/prism-backend/src/ring/linkPage.ts), [`routes.ts`](../packages/prism-backend/src/ring/routes.ts)) | Done |
| Confirm the link to Ring | `POST` then `PATCH /v1/accounts/me/app-integrations` with status `completed` ([`ringClient.ts`](../packages/prism-backend/src/ring/ringClient.ts)) | Done |
| HTTPS endpoints for Token Exchange, Account Link and the webhook | The public demo is HTTPS through CloudFront ([`infra/aws/demo`](../infra/aws/demo/README.md)). A production deployment needs its own domain and HTTPS to the origin | Partly |
| Account linking tested in Ring's staging environment, against staging and production endpoints | Not yet run against a live Ring account | To do |

## Webhooks

| Ring asks for | Prism | Status |
| --- | --- | --- |
| Verify `X-Signature` (`sha256=` and hex HMAC-SHA256 of the body, keyed with the app's signing key; not the Base64 used for nonces) | Checked on the raw bytes before parsing; anything else gets a 401 ([`webhookHandler.ts`](../packages/prism-backend/src/ring/webhookHandler.ts)) | Done |
| Answer within 5 seconds; a 4xx is permanent, a 5xx is retried | The event is stored and answered with a 200 before classification starts; malformed payloads get a 400, storage failures a 500 ([`routes.ts`](../packages/prism-backend/src/ring/routes.ts)) | Done |
| Expect the same event more than once | The event id is the primary key, so a redelivery is acknowledged without alerting twice | Done |
| Handle the user removing the app | `app_integration_removed` deletes that account's tokens | Done |

## Privacy and data

| Ring asks for | Prism | Status |
| --- | --- | --- |
| Respect privacy zones: obscure them or avoid processing them | Zones from `GET /v1/devices/{id}/configurations` are filled in black before a snapshot is classified, embedded or shown ([`privacyZones.ts`](../packages/prism-backend/src/ring/privacyZones.ts)). On a multi-camera device, Ring reports zones for one camera module, so Prism doesn't use images from the device's other modules | Done |
| Data minimization | Snapshots aren't stored; history is kept 30 days by default ([`PRIVACY.md`](PRIVACY.md)) | Done |
| Retention and deletion | Automatic deletion after `HISTORY_RETENTION_DAYS`; Settings > Your data deletes history now, after a confirmation step | Done |
| Data subject access requests | The household sees its full alert history in the app. There's no export of the stored data yet | Partly |
| AI governance: is Ring user data used to train models? | No. Snapshots go to Amazon Bedrock only to classify the event, and Catch up sends Bedrock the text of the alerts it looks up (no images) to answer the household's question; AWS states Bedrock doesn't store prompts or responses or use them for training ([`PRIVACY.md`](PRIVACY.md)) | Done |
| Documentation for facial recognition features, such as a privacy impact assessment | Prism doesn't do facial recognition. Known-visitor tagging is opt-in, off by default, and compares written descriptions of visible traits within one household's own database ([`PRIVACY.md`](PRIVACY.md)). A reviewer may still ask about it | Done, documented |
| Third parties | Amazon Bedrock (snapshots for classification, and alert text for Catch up) and the browser's push service, listed with what each receives ([`PRIVACY.md`](PRIVACY.md)) | Done |
| Links to a privacy policy and terms of service | `PRIVACY.md` describes what's stored and where it goes, but isn't a hosted legal privacy policy, and there are no terms of service yet | To do |

## Accessibility and design

| Ring asks for | Prism | Status |
| --- | --- | --- |
| WCAG 2.2 Level AA, per Ring's partner design guide | axe-core on every component and page state in `npm test` (zero violations), contrast checked from the palette, a keyboard-only walk, and a manual VoiceOver pass ([`ACCESSIBILITY.md`](ACCESSIBILITY.md)) | Done |
| The design guide's certification checklist | Not yet gone through item by item | To do |

## Security

| Ring asks for | Prism | Status |
| --- | --- | --- |
| No exposed credentials | Credentials come from the environment or an IAM role, never from files in the repository; the Ring client secret and signing key stay on the server | Done |
| Least privilege | The backend's AWS identity can only call `bedrock:InvokeModel` on its two models ([`bedrock-invoke-policy.json`](../infra/aws/bedrock-invoke-policy.json)) | Done |
| Tested for crashes and security vulnerabilities | Automated tests across all three packages; `npm audit --omit=dev` reports no known vulnerabilities in production dependencies (October 2026). No penetration test yet | Partly |

## Review logistics

| Ring asks for | Prism | Status |
| --- | --- | --- |
| Demo access, with the backend kept live during review | A public demo with simulated Ring events ([`infra/aws/demo`](../infra/aws/demo/README.md)) | Done |
| Stay within the API's rate limit (100 requests per second) | A few calls per event (one image download), the device list cached for 10 minutes, and event history read every 10 minutes | Done |

## Sources

Ring developer documentation on developer.amazon.com:
[certification](https://developer.amazon.com/docs/ring/certify.html),
[FAQ and certification best practices](https://developer.amazon.com/docs/ring/developer-faq.html),
[API development guide](https://developer.amazon.com/docs/ring/develop.html),
[Partner API documentation](https://developer.amazon.com/docs/ring/api-documentation.html),
[permitted content policy](https://developer.amazon.com/docs/ring/content-policy.html),
[app design guide](https://developer.amazon.com/docs/ring/ux-design-guide.html) and
[release notes](https://developer.amazon.com/docs/ring/release-notes.html).
