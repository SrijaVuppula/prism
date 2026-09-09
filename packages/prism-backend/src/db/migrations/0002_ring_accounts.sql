-- Stores the Ring OAuth token pair linked to a Prism user account.
-- user_id is Prism's own user identifier. There is no foreign key yet
-- because a users table does not exist in this codebase; add one once it does.
CREATE TABLE IF NOT EXISTS ring_accounts (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
