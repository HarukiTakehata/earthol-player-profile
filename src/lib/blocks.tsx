/**
 * Server-side rendering of profile blocks — the single place a `ProfileBlockRow`
 * becomes markup on the public profile.
 *
 * Security posture (deliberate):
 * - Text-block bodies are **user-authored MFM**, rendered through the same
 *   whitelisted integrator as the bio (`renderMfm` in `src/lib/mfm.ts`): every
 *   text run is escaped, links only survive as http(s), and `$[...]` functions
 *   only contribute classes/styles from its fixed allow-list. A body that
 *   fails to parse falls back to escaped plain text inside the integrator, so
 *   nothing user-authored reaches the DOM unescaped. Do not bypass the
 *   integrator with a looser renderer.
 * - Gallery `items` is a stored JSON array of arbitrary user strings. It is
 *   parsed defensively (a non-array or unparsable value yields no items) and
 *   an item only ever becomes an `<img src>` when it passes `isSafeUrl`, the
 *   same check the fields feature uses. Anything that fails is dropped from
 *   the DOM entirely — it is never emitted into an attribute, so a
 *   `javascript:` URL or a `" onerror="…` payload cannot reach the markup.
 *
 * Audience filtering lives in `src/lib/audience.ts`; this module only renders
 * rows a caller has already decided to show.
 */
import type { BlockKind, BlockVisibility, ProfileBlockRow } from '../db/types';
import { AUDIENCES, isBlockVisibility, isViewerIndependent } from './audience';
import { renderMfm } from './mfm';
import { isSafeUrl } from './validate';
import type { TranslateFn } from '../i18n';

/**
 * Parses a gallery block's stored `items` (a JSON array string) into the list
 * of image URLs that may be rendered. Returns `[]` for anything that is not a
 * JSON array of strings — a malformed stored value renders nothing rather
 * than throwing. Non-string entries are dropped, matching the defensive read.
 */
export function parseGalleryItems(items: string | null): string[] {
  if (!items) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(items);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * The audiences available in the dashboard editor, with their i18n labels.
 * Source: `AUDIENCES` — never a hand-written copy, so a new audience can only
 * be added in one place (`src/lib/audience.ts`).
 */
export function audienceOptions(t: TranslateFn): { value: BlockVisibility; label: string }[] {
  return AUDIENCES.map((value) => ({ value, label: t(`block.audience.${value}`) }));
}

/** i18n label for a block kind. */
export function blockKindLabel(kind: BlockKind, t: TranslateFn): string {
  return t(`block.kind.${kind}`);
}

/**
 * Narrows a D1 row's `kind` to `BlockKind`. D1 rows are untyped at the
 * boundary, so anything other than the two known literals is `null` and the
 * row renders nothing (fail closed, mirroring `isBlockVisibility`).
 */
function blockKindOf(row: ProfileBlockRow): BlockKind | null {
  return row.kind === 'text' || row.kind === 'gallery' ? row.kind : null;
}

/**
 * The rows that may be baked into the **shared** anonymous profile cache
 * (`profile:html:<locale>:<username>`, one copy served to every anonymous
 * visitor for 300s). This is the cache contract made explicit rather than
 * incidental: only blocks whose visibility is *provably* viewer-independent —
 * `isViewerIndependent` is true only for `'public'` — may enter that HTML, so
 * a future change to `canViewBlock` (say, widening `users` to anonymous
 * visitors) can never silently poison the shared copy. Filter here even
 * though anonymous viewers would fail the other audiences today.
 *
 * The result is derived from the profiled user's rows only — never from the
 * viewer, which does not exist on this path.
 */
export function cacheableBlocks(rows: readonly ProfileBlockRow[]): ProfileBlockRow[] {
  return rows.filter((row) => {
    const visibility = isBlockVisibility(row.visibility) ? row.visibility : null;
    return visibility !== null && isViewerIndependent(visibility);
  });
}

/**
 * Renders the blocks that belong inside the profile card, as one fragment.
 * Returns `null` when there is nothing to show — an empty block list renders
 * exactly as before (no empty shell, no layout shift). `isOwner` adds the
 * small audience marker so owners can tell what other viewers cannot see.
 */
export function ProfileBlocks(props: {
  rows: readonly ProfileBlockRow[];
  isOwner: boolean;
  t: TranslateFn;
}) {
  const { rows, isOwner, t } = props;
  if (rows.length === 0) return null;

  return (
    <div class="mt-5 space-y-4" data-blocks>
      {rows.map((row, index) => {
        const kind = blockKindOf(row);
        if (kind === null) return null;
        return (
          <div key={row.id ?? index} class="rounded-2xl bg-muted/40 p-4" data-block>
            {row.title ? <h3 class="break-words text-sm font-bold tracking-tight">{row.title}</h3> : null}
            {kind === 'text' ? (
              row.body ? (
                <div
                  class="mfm-body mt-1 break-words text-sm leading-relaxed text-foreground/85"
                  data-block-body
                  dangerouslySetInnerHTML={{ __html: renderMfm(row.body) }}
                />
              ) : null
            ) : (
              <GalleryGrid items={parseGalleryItems(row.items)} />
            )}
            {isOwner ? <BlockAudienceMarker row={row} t={t} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Lays out a gallery's safe images; unsafe items were dropped upstream. */
function GalleryGrid(props: { items: readonly string[] }) {
  const { items } = props;
  if (items.length === 0) return null;
  return (
    <div class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-block-gallery>
      {items.map((item, index) =>
        isSafeUrl(item) ? (
          <img
            key={index}
            src={item}
            alt=""
            loading="lazy"
            class="aspect-square w-full rounded-xl bg-card object-cover ring-1 ring-inset ring-border"
          />
        ) : null,
      )}
    </div>
  );
}

/** Owner-only marker naming the block's audience (mirrors the hidden-tag icon). */
function BlockAudienceMarker(props: { row: ProfileBlockRow; t: TranslateFn }) {
  const { row, t } = props;
  const visibility = isBlockVisibility(row.visibility) ? row.visibility : null;
  if (visibility === null) return null;
  return (
    <p class="mt-2 flex items-center gap-1 text-xs text-muted-foreground" data-block-audience>
      <span class="material-symbols-outlined icon-xs" aria-hidden="true">
        {visibility === 'public' ? 'public' : 'lock'}
      </span>
      {t('block_marker.audience', { audience: t(`block.audience.${visibility}`) })}
    </p>
  );
}
