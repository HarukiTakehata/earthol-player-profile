-- Migration 0001 · TOTP sign-in factors (`src/lib/totp.ts`).
-- Incremental change for EXISTING deployments: apply with `npm run db:migrate`
-- (local) or `npm run db:migrate:remote` (production). Fresh installs get the
-- same table from `schema.sql` directly — the IF NOT EXISTS guard keeps both
-- paths safe. Tracked and ordered by `wrangler d1 migrations`
-- (state lives in the `d1_migrations` table, so files apply exactly once).

CREATE TABLE IF NOT EXISTS totp_factors (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret     TEXT NOT NULL,
  confirmed  INTEGER NOT NULL DEFAULT 0,
  last_step  INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
