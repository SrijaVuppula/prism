-- Ring accounts linked to this household through Ring's one-way account
-- linking (see src/ring/accountLinking.ts). Ring sends Prism an
-- authorization code before the user has signed in to Prism, so the token
-- pair it's exchanged for is stored 'unclaimed' under the Ring Account ID,
-- and becomes 'linked' once the signed nonce on the Account Link redirect
-- has been matched to it.
--
-- Replaces ring_accounts, which keyed tokens by a Prism user id for a
-- partner-initiated OAuth flow Prism no longer uses.
DROP TABLE IF EXISTS ring_accounts;

CREATE TABLE IF NOT EXISTS ring_account_links (
  account_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'unclaimed' CHECK (status IN ('unclaimed', 'linked')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  linked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
