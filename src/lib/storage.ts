/**
 * Optional R2 object storage. When an `R2` bucket binding is present the
 * dashboard gains avatar uploads, served back through `GET /files/*`
 * (src/routes/files.ts); when the binding is absent every helper degrades
 * gracefully and the upload UI simply does not render. Objects are only ever
 * served through this Worker — never via public bucket URLs.
 */
import type { Env } from '../types';
import { randomToken } from './crypto';

/** Public URL prefix for stored objects. */
export const STORAGE_PATH_PREFIX = '/files/';

/** The one key namespace written and served today. */
export const STORAGE_PREFIX = 'avatars/';

/**
 * Keys we ever write or serve: `avatars/<userId>/<random token>.<ext>`. The
 * serving route rejects anything else, so stray bucket objects and traversal
 * tricks (`..`, encoded slashes) can never be read back.
 */
export const STORAGE_KEY_RE =
  /^avatars\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:png|jpg|gif|webp)$/;

/** 2 MiB — plenty for an avatar, small enough to buffer inside a Worker. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Content-type sniffing by magic bytes. The client-declared MIME type is
 * ignored entirely: what gets stored (and later served) is derived from the
 * actual bytes, so a mislabeled HTML/SVG/JS upload can never be served.
 */
function sniffImage(bytes: Uint8Array): { type: string; ext: string } | null {
  const ascii = (start: number, text: string): boolean => {
    for (let i = 0; i < text.length; i += 1) {
      if (bytes[start + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 'PNG')) {
    return { type: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  if (bytes.length >= 6 && ascii(0, 'GIF8')) {
    return { type: 'image/gif', ext: 'gif' };
  }
  if (bytes.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Runtime gate for the optional binding; narrows `env.R2` to a real bucket. */
export function storageEnabled(env: Env): env is Env & { R2: R2Bucket } {
  return typeof env.R2 !== 'undefined';
}

/** True for the same-origin `/files/...` paths this module hands out. */
export function isStoredPath(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(STORAGE_PATH_PREFIX) &&
    STORAGE_KEY_RE.test(value.slice(STORAGE_PATH_PREFIX.length))
  );
}

export type StoreImageError =
  | 'unavailable'
  | 'invalid_file'
  | 'file_too_large'
  | 'invalid_file_type';

export interface StoredImage {
  key: string;
  /** Same-origin public path, ready to store in `users.avatar_url`. */
  path: string;
  contentType: string;
}

/**
 * Validates and stores an uploaded image under
 * `avatars/<ownerId>/<random>.<ext>` and returns its public path, or an error
 * code for the route to translate. Only sniffed image types are accepted.
 */
export async function storeImage(
  env: Env,
  options: { ownerId: string; file: unknown; maxBytes: number },
): Promise<StoredImage | { error: StoreImageError }> {
  if (!storageEnabled(env)) return { error: 'unavailable' };

  const file = options.file;
  if (!(file instanceof File) || file.size === 0) return { error: 'invalid_file' };
  if (file.size > options.maxBytes) return { error: 'file_too_large' };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (!sniffed) return { error: 'invalid_file_type' };

  const key = `${STORAGE_PREFIX}${options.ownerId}/${randomToken(12)}.${sniffed.ext}`;
  await env.R2.put(key, bytes, { httpMetadata: { contentType: sniffed.type } });
  return { key, path: `${STORAGE_PATH_PREFIX}${key}`, contentType: sniffed.type };
}

/** Best-effort delete of a previously stored object; never throws. */
export async function deleteStoredImage(
  env: Env,
  path: string | null | undefined,
): Promise<void> {
  if (!isStoredPath(path) || !storageEnabled(env)) return;
  try {
    await env.R2.delete(path.slice(STORAGE_PATH_PREFIX.length));
  } catch (error) {
    console.error('Stored avatar delete failed', error);
  }
}
