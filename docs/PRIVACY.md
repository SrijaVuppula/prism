# Privacy and your data

Prism runs on the household's own server: the backend, its Postgres
database and the companion app. Nothing below is sent anywhere else
except where this page says so.

## What Prism stores

| Data | Why | Kept for |
|---|---|---|
| Each alert: when it happened, which Ring device, Ring's event data | Alert history, deduplicating Ring's webhook retries | `HISTORY_RETENTION_DAYS` (30 days by default) |
| The description of what the camera saw, as an embedding (a list of numbers) | Recognizing a repeat visit within the session window | Same |
| Thumbs up/down votes on alerts | Adjusting the Signal Score for the household | Same |
| Visitor tags ("Mail carrier"), only if the household turns tagging on | Labeling a repeat visitor | Until no visit from that visitor is stored |
| Settings: time zone, quiet hours, haptic patterns, the tagging opt-in | Personalizing alerts | Until changed |
| Push subscriptions for the household's browsers | Sending Urgent alerts | Until the browser unsubscribes or the push service reports it gone |
| Ring access and refresh tokens for a linked Ring account | Calling the Ring API | Until the household removes Prism in the Ring app |

Snapshots aren't stored. Prism downloads an event's snapshot from Ring when
it's needed, keeps a few recent ones in memory, and fills the device's Ring
privacy zones in black before anything else sees the image (see
`docs/ARCHITECTURE.md`). Prism doesn't do facial recognition or any other
biometric identification: repeat-visitor memory compares written
descriptions of clothing and other visible traits (and, only if an image
embedding model is configured, overall image similarity), within a short
window on one device, and doesn't know who anyone is.

## What leaves the household's server

- **Amazon Bedrock**, in the AWS account the backend runs with, receives
  each snapshot and its description to classify the event and compute the
  embedding. AWS states that Bedrock doesn't store prompts or responses and
  doesn't use them to train models (unless the account owner turns on
  Bedrock's model invocation logging).
- **The browser's push service** (e.g. Google's for Chrome) carries Urgent
  alerts to subscribed devices, encrypted end to end with the subscription's
  keys.
- **Ring** receives Prism's API calls for the household's own devices.

## Deleting data

- **In the app:** Settings > Your data > Delete alert history deletes every
  stored alert, the repeat-visitor memory, votes and visitor tags, after a
  confirmation step. Settings, push subscriptions and the Ring connection
  are kept.
- **Automatically:** history older than `HISTORY_RETENTION_DAYS` (default
  30) is deleted when the backend starts and every six hours after.
- **Disconnecting Ring:** remove Prism in the Ring app. Ring then notifies
  Prism, which deletes the account's Ring tokens.
- **From the command line:** `npm run clear-history` does the same as the
  in-app delete.
