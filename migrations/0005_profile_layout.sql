-- Migration 0005 · Profile section order (`src/views/profile.tsx`).
--
-- A profile is now a vertical list of independent cards: the identity card
-- (fixed, first) followed by the profile blocks and the key/value "fields"
-- card in a user-chosen order. The blocks already carry `sort_order`; this
-- table only records where the fields card sits among them, as "the number of
-- blocks that come before it" (0 = first, N = last).
--
-- Idempotent on purpose (`CREATE TABLE IF NOT EXISTS` only): `schema.sql` is
-- applied with `d1 execute`, which never touches the `d1_migrations` ledger,
-- so every migration is still pending on a fresh install and will be re-run by
-- the first `wrangler d1 migrations apply`. Never use ALTER/rebuild here.
--
-- Apply with `npm run db:migrate` (local) or `npm run db:migrate:remote`.

CREATE TABLE IF NOT EXISTS profile_layout (
  user_id         TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  fields_position INTEGER NOT NULL DEFAULT 0,
  CHECK (fields_position >= 0)
);
