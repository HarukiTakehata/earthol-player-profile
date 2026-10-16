-- Migration 0004 · Profile block visibility rules (`src/lib/audience.ts`).
--
-- Adds the refined per-block access model **without touching `profile_blocks`**:
-- every new rule lives in two satellite tables created with `IF NOT EXISTS`, so
-- this file is idempotent and safe under any ordering — running it after a fresh
-- `schema.sql` (where the same tables already exist) is a no-op, exactly like
-- migrations 0001–0003. That is deliberate: a migration that rebuilds or alters
-- an existing table cannot be re-run, and `schema.sql` (applied with
-- `d1 execute`, which never touches the `d1_migrations` ledger) already contains
-- the final shape, so every migration stays pending on a fresh install and WILL
-- be re-applied by the first `wrangler d1 migrations apply`. Keeping migrations
-- idempotent is therefore the only ordering-proof option.
--
-- `profile_block_rules` is a 1:1 satellite of `profile_blocks` holding the
-- optional conditions; `profile_block_viewers` holds the explicit allow/deny
-- lists. Both cascade with the block. The legacy `profile_blocks.required_tag` /
-- `min_follow_days` columns cannot be dropped (SQLite has no `DROP COLUMN`
-- compatible guarantee here, and dropping is itself a one-shot change), so they
-- are folded into `profile_block_rules` and then cleared — a re-run copies
-- nothing because the source columns are NULL by then.
--
-- Apply with `npm run db:migrate` (local) or `npm run db:migrate:remote`.
-- Fresh installs get the same tables from `schema.sql` via `npm run db:init`.

CREATE TABLE IF NOT EXISTS profile_block_rules (
  block_id             TEXT PRIMARY KEY REFERENCES profile_blocks (id) ON DELETE CASCADE,
  relation             TEXT,
  required_tags        TEXT,
  tag_match            TEXT NOT NULL DEFAULT 'any',
  excluded_tags        TEXT,
  min_follow_days      INTEGER,
  min_account_age_days INTEGER,
  visible_from         INTEGER,
  visible_until        INTEGER,
  CHECK (relation IS NULL OR relation IN ('followers', 'following', 'mutual')),
  CHECK (tag_match IN ('any', 'all')),
  CHECK (min_follow_days IS NULL OR min_follow_days >= 0),
  CHECK (min_account_age_days IS NULL OR min_account_age_days >= 0),
  CHECK (visible_until IS NULL OR visible_from IS NULL OR visible_from < visible_until)
);

CREATE INDEX IF NOT EXISTS idx_profile_block_rules_relation ON profile_block_rules (relation);

CREATE TABLE IF NOT EXISTS profile_block_viewers (
  block_id TEXT NOT NULL REFERENCES profile_blocks (id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  PRIMARY KEY (block_id, user_id),
  CHECK (kind IN ('allow', 'deny'))
);

CREATE INDEX IF NOT EXISTS idx_profile_block_viewers_user ON profile_block_viewers (user_id);

-- Fold the legacy single-tag / follow-age conditions into the satellite table.
-- The PK conflict makes this idempotent, and the UPDATE below clears the source
-- columns so a re-run (which a fresh install always produces) copies nothing.
INSERT OR IGNORE INTO profile_block_rules (block_id, required_tags, min_follow_days)
SELECT
  id,
  CASE
    WHEN required_tag IS NULL OR trim(required_tag) = '' THEN NULL
    ELSE json_array(lower(trim(required_tag)))
  END,
  min_follow_days
FROM profile_blocks
WHERE (required_tag IS NOT NULL AND trim(required_tag) <> '')
   OR min_follow_days IS NOT NULL;

UPDATE profile_blocks
SET required_tag = NULL, min_follow_days = NULL
WHERE required_tag IS NOT NULL OR min_follow_days IS NOT NULL;
