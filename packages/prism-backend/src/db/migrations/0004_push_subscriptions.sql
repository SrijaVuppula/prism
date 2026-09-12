-- Stores Web Push subscriptions for the companion app. No per-user column
-- yet -- the companion app has no auth of its own, so every subscription
-- here is treated as one of this household's companion devices and
-- receives every alert (see push/subscriptionStore.ts).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
