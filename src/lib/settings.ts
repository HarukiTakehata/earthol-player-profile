/**
 * Runtime site configuration, stored as key/value rows in the D1 `settings`
 * table and cached in KV (`settings:all`, 60s) so the per-request middleware
 * stays cheap. Keys that were never saved fall back to `DEFAULTS`.
 */
import type { Env } from '../types';
import { readSettings, writeSettings } from '../db/queries';
import { appName } from './env';

/**
 * Admin-editable overrides for the landing page (`/`) copy. Each key maps 1:1
 * to a `home.*` i18n message. An empty value means "use the built-in text for
 * the current locale", so overrides are opt-in per field and per site.
 */
export const LANDING_COPY_KEYS = [
  'badge',
  'heroLead',
  'heroAccent',
  'heroTail',
  'subtitle',
  'ctaClaim',
  'ctaHow',
  'step1Title',
  'step1Body',
  'step2Title',
  'step2Body',
  'step3Title',
  'step3Body',
] as const;

export type LandingCopyKey = (typeof LANDING_COPY_KEYS)[number];
export type LandingCopy = Record<LandingCopyKey, string>;

export const MAX_LANDING_COPY = 300;
export const MAX_LANDING_URL = 500;

const DEFAULT_LANDING_COPY: LandingCopy = {
  badge: '',
  heroLead: '',
  heroAccent: '',
  heroTail: '',
  subtitle: '',
  ctaClaim: '',
  ctaHow: '',
  step1Title: '',
  step1Body: '',
  step2Title: '',
  step2Body: '',
  step3Title: '',
  step3Body: '',
};

/** Parses the stored JSON blob, ignoring unknown keys and malformed input. */
function parseLandingCopy(raw: string | undefined): LandingCopy {
  const copy = { ...DEFAULT_LANDING_COPY };
  if (!raw) return copy;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of LANDING_COPY_KEYS) {
      const value = parsed[key];
      if (typeof value === 'string') copy[key] = value.slice(0, MAX_LANDING_COPY);
    }
  } catch {
    /* malformed JSON falls back to all-defaults */
  }
  return copy;
}

export interface SiteSettings {
  siteName: string;
  landingCopy: LandingCopy;
  landingCtaPrimaryUrl: string;
  landingCtaSecondaryUrl: string;
  faviconUrl: string;
  logoUrl: string;
  signupsEnabled: boolean;
  maintenanceMode: boolean;
  githubLoginEnabled: boolean;
  magicLinkEnabled: boolean;
  defaultTheme: string;
  defaultVisibility: string;
  customCss: string;
  customJs: string;
  customFooter: string;
  githubClientId: string;
  githubClientSecret: string;
  mailerDriver: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: string;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  gravatarMirror: string;
  // AI Configuration
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiPromptChat: string;
}

const CACHE_KEY = 'settings:all';
const CACHE_TTL = 60;

const KEY = {
  siteName: 'site_name',
  landing: 'landing_copy',
  landingCtaPrimaryUrl: 'landing_cta_primary_url',
  landingCtaSecondaryUrl: 'landing_cta_secondary_url',
  faviconUrl: 'favicon_url',
  logoUrl: 'logo_url',
  signups: 'signups_enabled',
  maintenance: 'maintenance_mode',
  github: 'github_login_enabled',
  magic: 'magic_link_enabled',
  defaultTheme: 'default_theme',
  defaultVisibility: 'default_visibility',
  customCss: 'custom_css',
  customJs: 'custom_js',
  customFooter: 'custom_footer',
  githubClientId: 'github_client_id',
  githubClientSecret: 'github_client_secret',
  mailerDriver: 'mailer_driver',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUser: 'smtp_user',
  smtpPassword: 'smtp_password',
  smtpFrom: 'smtp_from',
  gravatarMirror: 'gravatar_mirror',
  // AI Configuration
  openaiApiKey: 'openai_api_key',
  openaiBaseUrl: 'openai_base_url',
  openaiModel: 'openai_model',
  openaiPromptChat: 'openai_prompt_chat',
};

const DEFAULTS: SiteSettings = {
  siteName: '',
  landingCopy: { ...DEFAULT_LANDING_COPY },
  landingCtaPrimaryUrl: '',
  landingCtaSecondaryUrl: '',
  faviconUrl: '',
  logoUrl: '',
  signupsEnabled: true,
  maintenanceMode: false,
  githubLoginEnabled: true,
  magicLinkEnabled: true,
  defaultTheme: 'default',
  defaultVisibility: 'public',
  customCss: '',
  customJs: '',
  customFooter: '',
  githubClientId: '',
  githubClientSecret: '',
  mailerDriver: '',
  smtpHost: '',
  smtpPort: '',
  smtpSecure: '',
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  gravatarMirror: '',
  // AI Configuration
  openaiApiKey: '',
  openaiBaseUrl: '',
  openaiModel: 'gpt-3.5-turbo',
  openaiPromptChat: '',
};

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value === 'true';
}

/**
 * Read settings: KV cache first, then D1. A transient D1 failure degrades to
 * defaults instead of failing the request.
 */
export async function getSettings(env: Env): Promise<SiteSettings> {
  try {
    const cached = (await env.KV.get(CACHE_KEY, 'json')) as SiteSettings | null;
    if (cached) return { ...DEFAULTS, ...cached };
  } catch {
    /* fall through to DB */
  }

  let map: Record<string, string> = {};
  try {
    map = await readSettings(env.DB);
  } catch {
    map = {};
  }

  const settings: SiteSettings = {
    siteName: map[KEY.siteName] ?? '',
    landingCopy: parseLandingCopy(map[KEY.landing]),
    landingCtaPrimaryUrl: map[KEY.landingCtaPrimaryUrl] ?? '',
    landingCtaSecondaryUrl: map[KEY.landingCtaSecondaryUrl] ?? '',
    faviconUrl: map[KEY.faviconUrl] ?? DEFAULTS.faviconUrl,
    logoUrl: map[KEY.logoUrl] ?? DEFAULTS.logoUrl,
    signupsEnabled: toBool(map[KEY.signups], DEFAULTS.signupsEnabled),
    maintenanceMode: toBool(map[KEY.maintenance], DEFAULTS.maintenanceMode),
    githubLoginEnabled: toBool(map[KEY.github], DEFAULTS.githubLoginEnabled),
    magicLinkEnabled: toBool(map[KEY.magic], DEFAULTS.magicLinkEnabled),
    defaultTheme: map[KEY.defaultTheme] ?? DEFAULTS.defaultTheme,
    defaultVisibility: map[KEY.defaultVisibility] ?? DEFAULTS.defaultVisibility,
    customCss: map[KEY.customCss] ?? DEFAULTS.customCss,
    customJs: map[KEY.customJs] ?? DEFAULTS.customJs,
    customFooter: map[KEY.customFooter] ?? DEFAULTS.customFooter,
    githubClientId: map[KEY.githubClientId] ?? DEFAULTS.githubClientId,
    githubClientSecret: map[KEY.githubClientSecret] ?? DEFAULTS.githubClientSecret,
    mailerDriver: map[KEY.mailerDriver] ?? DEFAULTS.mailerDriver,
    smtpHost: map[KEY.smtpHost] ?? DEFAULTS.smtpHost,
    smtpPort: map[KEY.smtpPort] ?? DEFAULTS.smtpPort,
    smtpSecure: map[KEY.smtpSecure] ?? DEFAULTS.smtpSecure,
    smtpUser: map[KEY.smtpUser] ?? DEFAULTS.smtpUser,
    smtpPassword: map[KEY.smtpPassword] ?? DEFAULTS.smtpPassword,
    smtpFrom: map[KEY.smtpFrom] ?? DEFAULTS.smtpFrom,
    gravatarMirror: map[KEY.gravatarMirror] ?? DEFAULTS.gravatarMirror,
    // AI Configuration
    openaiApiKey: map[KEY.openaiApiKey] ?? DEFAULTS.openaiApiKey,
    openaiBaseUrl: map[KEY.openaiBaseUrl] ?? DEFAULTS.openaiBaseUrl,
    openaiModel: map[KEY.openaiModel] ?? DEFAULTS.openaiModel,
    openaiPromptChat: map[KEY.openaiPromptChat] ?? DEFAULTS.openaiPromptChat,
  };

  try {
    await env.KV.put(CACHE_KEY, JSON.stringify(settings), { expirationTtl: CACHE_TTL });
  } catch {
    /* cache is best-effort */
  }

  return settings;
}

/** Persist all settings (batched upsert) then invalidate the KV cache. */
export async function saveSettings(env: Env, settings: SiteSettings): Promise<void> {
  await writeSettings(env.DB, {
    [KEY.siteName]: settings.siteName,
    [KEY.landing]: JSON.stringify(settings.landingCopy),
    [KEY.landingCtaPrimaryUrl]: settings.landingCtaPrimaryUrl,
    [KEY.landingCtaSecondaryUrl]: settings.landingCtaSecondaryUrl,
    [KEY.faviconUrl]: settings.faviconUrl,
    [KEY.logoUrl]: settings.logoUrl,
    [KEY.signups]: settings.signupsEnabled ? '1' : '0',
    [KEY.maintenance]: settings.maintenanceMode ? '1' : '0',
    [KEY.github]: settings.githubLoginEnabled ? '1' : '0',
    [KEY.magic]: settings.magicLinkEnabled ? '1' : '0',
    [KEY.defaultTheme]: settings.defaultTheme,
    [KEY.defaultVisibility]: settings.defaultVisibility,
    [KEY.customCss]: settings.customCss,
    [KEY.customJs]: settings.customJs,
    [KEY.customFooter]: settings.customFooter,
    [KEY.githubClientId]: settings.githubClientId,
    [KEY.githubClientSecret]: settings.githubClientSecret,
    [KEY.mailerDriver]: settings.mailerDriver,
    [KEY.smtpHost]: settings.smtpHost,
    [KEY.smtpPort]: settings.smtpPort,
    [KEY.smtpSecure]: settings.smtpSecure,
    [KEY.smtpUser]: settings.smtpUser,
    [KEY.smtpPassword]: settings.smtpPassword,
    [KEY.smtpFrom]: settings.smtpFrom,
    [KEY.gravatarMirror]: settings.gravatarMirror,
    // AI Configuration
    [KEY.openaiApiKey]: settings.openaiApiKey,
    [KEY.openaiBaseUrl]: settings.openaiBaseUrl,
    [KEY.openaiModel]: settings.openaiModel,
    [KEY.openaiPromptChat]: settings.openaiPromptChat,
  });
  try {
    await env.KV.delete(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * App display name. The `APP_NAME` env var wins over the admin `siteName`
 * setting (which itself wins over the built-in default), matching the env-lock
 * rule: when `APP_NAME` is set, the console cannot change the name.
 */
export function resolveAppName(env: Env, settings: SiteSettings): string {
  return env.APP_NAME?.trim() || settings.siteName.trim() || appName(env);
}
