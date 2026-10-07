/**
 * OpenAI client resolution with environment-variable precedence.
 *
 * The API key, base URL and model can each be configured in the admin panel
 * (D1 `settings`) or through Worker env vars/secrets. An env var always wins,
 * matching `envLocks` and the other `resolve*` helpers in `lib/config`.
 * The client is only ever constructed here so runtime call sites never read
 * `env.OPENAI_*` directly.
 */
import { OpenAI } from 'openai';
import type { Env } from '../types';
import type { SiteSettings } from './settings';

export interface ResolvedOpenAI {
  client: OpenAI;
  model: string;
}

const DEFAULT_MODEL = 'gpt-3.5-turbo';

/** System prompt used when the admin leaves the chat prompt blank. */
export const DEFAULT_CHAT_PROMPT =
  'You are the assistant built into a player-profile page builder. Help the user ' +
  'write and improve their profile — display name, headline, bio, location, pronouns, ' +
  'key/value fields, and tags. Be concise and reply in the same language the user writes in.';

/**
 * Resolve the effective OpenAI client or `null` when no API key is configured
 * anywhere (env var first, then the admin setting). Presence of a key is the
 * only check — the key is not validated against the provider.
 */
export function resolveOpenAI(env: Env, settings: SiteSettings): ResolvedOpenAI | null {
  const apiKey = env.OPENAI_API_KEY?.trim() || settings.openaiApiKey;
  if (!apiKey) return null;

  const baseURL = env.OPENAI_BASE_URL?.trim() || settings.openaiBaseUrl || undefined;
  const model = env.OPENAI_MODEL?.trim() || settings.openaiModel || DEFAULT_MODEL;

  return { client: new OpenAI({ apiKey, baseURL }), model };
}
