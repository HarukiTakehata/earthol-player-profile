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
 * leans on the same property. A per-block "which tag" column, or a per-user
 * allowlist audience, would be separate features and neither is implied here.
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
export function canViewBlock(visibility: BlockVisibility, ctx: AudienceContext): boolean {
  if (ctx.isOwner) return true;
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
 * True iff the rendered result is identical for every viewer — only `public`.
 * This is the profile-cache contract made explicit: the anonymous KV-cached
 * profile HTML (`src/lib/profile-cache.ts`, one copy served to every visitor
 * for 300s) may embed only blocks whose visibility passes this test, so a
 * caller cannot accidentally bake a viewer-specific block into shared cache.
 * An unknown visibility is viewer-dependent by the same fail-closed rule: if
 * it cannot be proven shareable with the world, it must not be cached.
 */
export function isViewerIndependent(visibility: BlockVisibility): boolean {
  return visibility === 'public';
}
