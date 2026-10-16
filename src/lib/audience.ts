/**
 * Audience predicates for profile blocks. Pure logic — no D1, no KV, no Hono,
 * no views: the question "may this viewer see this block?" is factored out so
 * the routes, the SSR views, and any future tests share exactly one answer.
 *
 * The four audiences form a narrowing ladder, and `AUDIENCES` lists them in
 * that order (widest first): `public` (everyone, anonymous included) → `users`
 * (any signed-in account) → `same_tag` (signed-in *and* sharing at least one
 * tag value with the owner) → `self` (the owner only). `BlockVisibility` in
 * `src/db/types.ts` and the `profile_blocks.visibility` CHECK in `schema.sql`
 * must always agree with `AUDIENCES`; the literals are re-declared there
 * because SQL cannot import this module.
 *
 * `same_tag` has no matching column — `profile_blocks` stores no tag value —
 * so the audience is computed by *intersecting* the viewer's and the owner's
 * normalised tag-value collections: "the viewer shares at least one tag value
 * with the profile owner". It is deliberately explicit and owner-chosen (the
 * owner opts a block into "people who share a tag with me" instead of naming a
 * target tag), and it is a membership oracle by nature: a viewer can probe for
 * blocks by adding candidate tag values to their own profile and re-fetching,
 * watching which blocks appear. That is an accepted product trade-off, not a
 * bug to paper over — the existing hidden-tag rule in `src/views/profile.tsx`
 * leans on the same property.
 *
 * On top of the four audiences, each block may carry up to two optional
 * *conditions* (`BlockConditions`), ANDed in `canViewBlock`: `requiredTag`
 * (the viewer must carry one specific normalised tag value — the per-block
 * "which tag" refinement of `same_tag`) and `minFollowDays` (the viewer must
 * have been following for at least N whole days, 0 = any follower). Both are
 * answered differently by different viewers, so `isViewerIndependent` treats
 * any block carrying one as viewer-dependent and keeps it out of the shared
 * anonymous cache.
 */
import type { BlockVisibility } from '../db/types';

/** Canonical, widest→narrowest list of the audiences. Single source of truth. */
export const AUDIENCES: readonly BlockVisibility[] = ['public', 'users', 'same_tag', 'self'];

const KNOWN_AUDIENCES = new Set<unknown>(AUDIENCES);

/**
 * Strict runtime guard for a visibility coming from a form body, a JSON blob,
 * or a D1 row. Rejects non-strings, the empty string, and unknown literals, so
 * a typo can never reach `canViewBlock` unchallenged.
 */
export function isBlockVisibility(value: unknown): value is BlockVisibility {
  return typeof value === 'string' && KNOWN_AUDIENCES.has(value);
}

/**
 * Coerces one raw tag value to its canonical form: only strings are accepted,
 * then trimmed and lower-cased. Anything else (null, numbers, objects, …)
 * yields `''`, and an empty result always means "no value" — never a value
 * that could match. The trim+case fold is what makes `'  Kaji '` and `'kaji`
 * the same tag; `src/lib/validate.ts` uses the same fold for usernames.
 */
export function normaliseTagValue(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Normalises a whole collection of raw tag values (`normaliseTagValue` per
 * item), dropping every empty result. Tolerates `null`, `undefined`, and any
 * non-iterable junk by returning an empty set rather than throwing — tag
 * collections arrive from form bodies and D1 rows, neither of which is typed
 * at the boundary. A lone string is treated as one value, never as its
 * characters: nothing a caller passes in should ever split `'kaji'` into `k`,
 * `a`, `j`, `i`.
 */
export function normaliseTagValues(raw: Iterable<unknown> | null | undefined): Set<string> {
  const values = new Set<string>();
  if (raw == null) return values;

  const source: unknown = raw;
  if (typeof source === 'string') {
    const value = normaliseTagValue(source);
    if (value !== '') values.add(value);
    return values;
  }
  if (typeof source !== 'object' || typeof (source as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== 'function') {
    return values;
  }

  for (const item of source as Iterable<unknown>) {
    const value = normaliseTagValue(item);
    if (value !== '') values.add(value);
  }
  return values;
}

/**
 * True iff the two (already-normalised) tag-value collections intersect.
 * Either set being empty means no sharing: an owner with no tags must not
 * "share" with a viewer who also has none, and a tagless viewer cannot match
 * anyone either — an empty collection is the absence of a claim, not a claim
 * that matches everything.
 */
export function shareTagValue(viewerTagValues: ReadonlySet<string>, ownerTagValues: ReadonlySet<string>): boolean {
  if (viewerTagValues.size === 0 || ownerTagValues.size === 0) return false;
  // Probe the smaller collection against the larger one.
  const [probe, lookup] =
    viewerTagValues.size <= ownerTagValues.size ? [viewerTagValues, ownerTagValues] : [ownerTagValues, viewerTagValues];
  for (const value of probe) {
    if (lookup.has(value)) return true;
  }
  return false;
}

/**
 * The two optional per-block conditions that refine the base `visibility`.
 * Both are ANDed on top of it in `canViewBlock`; both `null` means "no extra
 * condition". `requiredTag` is a normalised tag value the viewer must carry,
 * and `minFollowDays` is the minimum whole days the viewer has been following
 * (0 = any follower, regardless of duration).
 *
 * Either condition is viewer-dependent by nature — the answer changes with
 * *who* is looking — so a block carrying one is never baked into the shared
 * anonymous cache (see `isViewerIndependent`).
 */
export interface BlockConditions {
  /** Normalised tag value the viewer must have, or null for no tag condition. */
  requiredTag: string | null;
  /** Minimum whole days the viewer has been following, or null for none. */
  minFollowDays: number | null;
}

/** The "no extra condition" pair — the common case for a plain block. */
export const NO_CONDITIONS: BlockConditions = { requiredTag: null, minFollowDays: null };

/** True when at least one condition is set (a viewer-dependent refinement). */
export function hasConditions(conditions: BlockConditions): boolean {
  return conditions.requiredTag !== null || conditions.minFollowDays !== null;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two epoch-ms timestamps, clamped at zero (clock skew). */
export function wholeDaysBetween(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / MS_PER_DAY));
}

/**
 * Does a follow that started at `followStartedAt` satisfy a `minFollowDays`
 * requirement? Not following (`null`) never satisfies any requirement — even
 * 0 (which means "any follower"), because a non-follower is not a follower.
 */
export function meetsMinFollowDays(
  minFollowDays: number,
  followStartedAt: number | null,
  now: number,
): boolean {
  if (followStartedAt === null) return false;
  return wholeDaysBetween(followStartedAt, now) >= minFollowDays;
}

/**
 * Reads a stored row's condition columns defensively and normalises them,
 * mirroring `isBlockVisibility`'s fail-closed stance: a missing or malformed
 * value degrades to "no condition" (the rule is simply not enforced), never
 * to a value that could widen the audience.
 */
export function conditionsOfRow(row: {
  required_tag: unknown;
  min_follow_days: unknown;
}): BlockConditions {
  return {
    requiredTag: normaliseTagValue(row.required_tag) || null,
    minFollowDays: nonNegativeIntOrNull(row.min_follow_days),
  };
}

function nonNegativeIntOrNull(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Everything `canViewBlock` needs to know about one (viewer, owner) pair. */
export interface AudienceContext {
  /** True when the viewer is the profile's owner. An unconditional override. */
  isOwner: boolean;
  /** True when the request carried a valid session. Anonymous = false. */
  viewerIsAuthenticated: boolean;
  /** The viewer's normalised tag values; empty for an anonymous viewer. */
  viewerTagValues: ReadonlySet<string>;
  /** The owner's normalised tag values (all of them, hidden tags included). */
  ownerTagValues: ReadonlySet<string>;
  /** Epoch ms the viewer started following the owner, or null if not following. */
  followStartedAt: number | null;
  /** "Now" in epoch ms — injected by the caller so this stays pure/testable. */
  now: number;
}

/**
 * The single decision point: may this viewer see this block?
 *
 * The owner branch is unconditional and comes first. Owners are authenticated
 * in practice, but correctness must not depend on the caller *also* remembering
 * to pass a truthful `viewerIsAuthenticated` alongside `isOwner` — a bogus
 * context should still give the owner their own blocks.
 *
 * Everything else fails closed: an unknown or typo'd visibility reaching this
 * function (a value that slipped past the storage CHECK — a hand-written
 * INSERT, or a stale row left behind if a literal were ever renamed) is *not*
 * viewable by a non-owner. Hiding the block is always the safe failure.
 */
export function canViewBlock(
  visibility: BlockVisibility,
  conditions: BlockConditions,
  ctx: AudienceContext,
): boolean {
  if (ctx.isOwner) return true; // Owners always see their own blocks, conditions included.

  // The base audience must pass first (a `self` block already fails here for
  // non-owners). The conditions are then ANDed on top: each one that is set
  // must be satisfied by this specific viewer.
  if (!baseAudienceVisible(visibility, ctx)) return false;
  if (conditions.requiredTag !== null && !ctx.viewerTagValues.has(conditions.requiredTag)) {
    return false;
  }
  if (
    conditions.minFollowDays !== null &&
    !meetsMinFollowDays(conditions.minFollowDays, ctx.followStartedAt, ctx.now)
  ) {
    return false;
  }
  return true;
}

/**
 * The base four-audience decision (widest→narrowest) before any per-block
 * conditions are applied. Extracted so the conditions read as a clean AND on
 * top of it. Fails closed on an unknown visibility.
 */
function baseAudienceVisible(visibility: BlockVisibility, ctx: AudienceContext): boolean {
  switch (visibility) {
    case 'public':
      return true; // Everyone, anonymous viewers included.
    case 'users':
      return ctx.viewerIsAuthenticated;
    case 'same_tag':
      // Authentication is enforced explicitly rather than inferred from the
      // tag sets: an anonymous viewer has no tags of record, so a populated
      // `viewerTagValues` for one could only be a caller bug — a stale set, or
      // the owner's own tags reused — that would silently widen the audience.
      // The session is the trusted signal; the tag sets are not.
      return ctx.viewerIsAuthenticated && shareTagValue(ctx.viewerTagValues, ctx.ownerTagValues);
    case 'self':
      return false; // Owner only, handled by the override above.
    default:
      return false; // Unknown visibility: fail closed for non-owners.
  }
}

/**
 * True iff the rendered result is identical for every viewer. This is the
 * profile-cache contract made explicit: the anonymous KV-cached profile HTML
 * (`src/lib/profile-cache.ts`, one copy served to every visitor for 300s) may
 * embed only blocks that pass this test, so a caller cannot accidentally bake
 * a viewer-specific block into the shared cache. Only a `public` block with no
 * conditions qualifies — `users`/`same_tag`/`self` and both conditions all
 * vary by viewer. An unknown visibility is viewer-dependent by the same
 * fail-closed rule: if it cannot be proven shareable with the world, it must
 * not be cached.
 */
export function isViewerIndependent(visibility: BlockVisibility, conditions: BlockConditions): boolean {
  return visibility === 'public' && !hasConditions(conditions);
}
