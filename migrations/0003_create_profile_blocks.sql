-- Migration 0003 · Profile blocks (`src/db/queries.ts`).
-- Modular profile content: each user assembles an ordered list of blocks (a
-- text block or a gallery block), each with its own audience. Incremental
-- change for EXISTING deployments: apply with `npm run db:migrate` (local) or
-- `npm run db:migrate:remote` (production). Fresh installs get the same table
-- from `schema.sql` directly — the IF NOT EXISTS guard keeps both paths safe.
-- Tracked and ordered by `wrangler d1 migrations` (state lives in the
-- `d1_migrations` table, so files apply exactly once).
--
-- The FK cascades so deleting a user removes their blocks. `idx_profile_blocks_user`
-- covers the per-user list ordered by `sort_order` (the same shape as
-- `idx_user_tags_user`). The CHECK constraints make the table itself reject a
-- bad `kind`, a bad `visibility`, a 'text' block without a body, a 'gallery'
-- block without items, and a negative `min_follow_days` — the audience/kind
-- literals are the storage contract shared with `src/db/types.ts`.
--
-- Two optional per-block conditions refine the base `visibility` (both AND
-- on top of it, see `src/lib/audience.ts`): `required_tag` is a normalised
-- tag value the viewer must carry, and `min_follow_days` is the minimum
-- whole days the viewer must have been following (0 = any follower).
CREATE TABLE IF NOT EXISTS profile_blocks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  title            TEXT,
  body             TEXT,
  items            TEXT,
  visibility       TEXT NOT NULL DEFAULT 'public',
  required_tag     TEXT,
  min_follow_days  INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK (kind IN ('text', 'gallery')),
  CHECK (visibility IN ('public', 'users', 'same_tag', 'self')),
  CHECK (kind <> 'text' OR body IS NOT NULL),
  CHECK (kind <> 'gallery' OR items IS NOT NULL),
  CHECK (min_follow_days IS NULL OR min_follow_days >= 0)
);

CREATE INDEX IF NOT EXISTS idx_profile_blocks_user ON profile_blocks (user_id, sort_order);
