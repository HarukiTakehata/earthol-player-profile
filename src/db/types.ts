/** Row shapes returned by D1, matching `schema.sql` column-for-column. */

/** The kinds of profile block a user can add to their profile. */
export type BlockKind = 'text' | 'gallery';

/**
 * Per-block audience. Mirrors the `profile_blocks.visibility` CHECK in
 * `schema.sql` — shared with the audience predicate, so the two must always
 * agree on the literal values.
 */
export type BlockVisibility = 'public' | 'users' | 'same_tag' | 'self';

export interface UserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;
  avatar_url: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
  is_admin: number;
  created_at: number;
  updated_at: number;
}

export interface IdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  email: string | null;
  created_at: number;
}

export interface FieldRow {
  id: string;
  user_id: string;
  label: string;
  value: string;
  sort_order: number;
  created_at: number;
}

export interface TagCategoryRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
}

export interface UserTagRow {
  id: string;
  user_id: string;
  category_id: string;
  value: string;
  hidden: number;
  sort_order: number;
  created_at: number;
  category_name: string;
  category_color: string;
}

export interface FollowRow {
  follower_id: string;
  following_id: string;
  created_at: number;
}

export interface LoginTokenRow {
  token_hash: string;
  email: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

export interface TotpFactorRow {
  user_id: string;
  secret: string;
  confirmed: number;
  last_step: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProfileInput {
  username: string;
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  location: string | null;
  website: string | null;
  pronouns: string | null;
  theme: string;
  visibility: string;
}

export interface FieldInput {
  label: string;
  value: string;
}

/**
 * A profile block as a caller supplies it. `user_id`, `id`, and the timestamps
 * are assigned by `replaceProfileBlocks` — never by the caller. A 'text' block
 * must carry a non-null `body`, a 'gallery' block a non-null `items` (a JSON
 * array string), matching the table's CHECK constraints. `requiredTag` and
 * `minFollowDays` are the two optional conditions that refine `visibility`
 * (see `src/lib/audience.ts`); both null means "no extra condition".
 */
export interface BlockInput {
  kind: BlockKind;
  title: string | null;
  body: string | null;
  items: string | null;
  visibility: BlockVisibility;
  requiredTag: string | null;
  minFollowDays: number | null;
}

export interface ProfileBlockRow {
  id: string;
  user_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  items: string | null;
  visibility: string;
  /** Normalised tag value the viewer must have, or null for no tag condition. */
  required_tag: string | null;
  /** Minimum whole days the viewer must have been following, or null for none. */
  min_follow_days: number | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface TagInput {
  categoryId: string;
  value: string;
  hidden: boolean;
}
