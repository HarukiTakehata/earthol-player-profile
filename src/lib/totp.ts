/**
 * TOTP (RFC 6238) on the Workers Web Crypto runtime — no Node crypto, no
 * dependencies. Uses the parameters every mainstream authenticator app
 * expects: SHA-1, 6 digits, 30-second steps, Base32 (RFC 4648) secrets.
 */
import { timingSafeEqual } from './crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  // 160-bit secret (20 bytes) — the Google Authenticator default, which
  // encodes to exactly 32 Base32 characters with no padding.
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[=\s]/g, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

async function hotpCode(key: Uint8Array, counter: number): Promise<string> {
  // RFC 4226: the counter is an 8-byte big-endian integer.
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  const digest = await hmacSha1(key, message);
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentTotpStep(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

export interface TotpVerifyResult {
  valid: boolean;
  /** Time step of the matched code, for replay protection. */
  step: number;
}

/**
 * Verifies a user-supplied code against the current step and `window` steps on
 * either side (clock drift). A step at or before `lastStep` is rejected, so a
 * code that was already accepted can never be replayed.
 */
export async function verifyTotp(
  secret: string,
  code: string,
  options: { window?: number; lastStep?: number | null } = {},
): Promise<TotpVerifyResult> {
  const normalized = code.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: 0 };
  const key = base32Decode(secret);
  if (key.length === 0) return { valid: false, step: 0 };
  const current = currentTotpStep();
  const window = options.window ?? 1;
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (options.lastStep != null && step <= options.lastStep) continue;
    const expected = await hotpCode(key, step);
    if (timingSafeEqual(expected, normalized)) return { valid: true, step };
  }
  return { valid: false, step: 0 };
}

/** otpauth:// provisioning URI for QR codes and manual entry. */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
