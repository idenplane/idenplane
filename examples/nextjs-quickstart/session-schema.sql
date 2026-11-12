-- Apply only to the application's dedicated session database/role.
-- No raw cookie identifiers or plaintext OAuth credentials are stored here.
CREATE TABLE IF NOT EXISTS bff_sessions (
  sid_hash text PRIMARY KEY CHECK (sid_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('login', 'session')),
  state_hash text,
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  idle_seconds integer NOT NULL CHECK (idle_seconds BETWEEN 1 AND 86400),
  CHECK ((kind='login' AND state_hash IS NOT NULL AND state_hash ~ '^[0-9a-f]{64}$') OR (kind='session' AND state_hash IS NULL))
);
CREATE INDEX IF NOT EXISTS bff_sessions_expiry ON bff_sessions (expires_at);
