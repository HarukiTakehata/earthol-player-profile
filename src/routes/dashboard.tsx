/**
 * Authenticated dashboard: profile sheet, key/value fields, and tags. Fields
 * and tags are replaced wholesale on submit; every write invalidates the
 * profile HTML cache for the affected handle.
 */
import { Hono } from 'hono';
import type { AppContext } from '../types';
import { Dashboard } from '../views/dashboard';
import type { FieldInput, TagInput } from '../db/types';
import {
  createLoginToken,
  getUserByEmail,
  isUsernameReserved,
  isUsernameTakenByOther,
  listFields,
  listIdentities,
  listTagCategories,
  listUserTags,
  replaceFields,
  replaceUserTags,
  updateProfile,
} from '../db/queries';
import { requireAuth } from '../middleware/auth';
import { invalidateProfiles } from '../lib/profile-cache';
import { gravatarAvatarUrl } from '../lib/gravatar';
import { githubConfigured } from '../lib/oauth-github';
import { resolveGithub, resolveGravatarMirror, resolveMailer } from '../lib/config';
import { DEFAULT_CHAT_PROMPT, resolveOpenAI } from '../lib/openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { isTheme, isVisibility } from '../lib/themes';
import {
  isSafeUrl,
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizeUsername,
  text,
} from '../lib/validate';
import { randomToken, sha256Hex } from '../lib/crypto';
import { getMailer, magicLinkEmail } from '../lib/email';
import { clientIp, rateLimit } from '../lib/ratelimit';
import { appUrl } from '../lib/env';
import type { TranslateFn } from '../i18n';

export const dashboardRoutes = new Hono<AppContext>();

const MAX_FIELDS = 20;
const MAX_FIELD_LABEL = 40;
const MAX_FIELD_VALUE = 300;
const MAX_TAGS = 20;
const MAX_TAG_VALUE = 40;
const LINK_TTL_SECONDS = 15 * 60;

dashboardRoutes.use('/dashboard', requireAuth);
dashboardRoutes.use('/dashboard/*', requireAuth);

function errorMessage(code: string | undefined, t: TranslateFn): string | undefined {
  switch (code) {
    case 'invalid_username':
      return t('dash.err.invalidUsername');
    case 'reserved_username':
      return t('dash.err.reserved');
    case 'taken_username':
      return t('dash.err.taken');
    case 'invalid_url':
      return t('dash.err.invalidUrl');
    case 'invalid_field':
      return t('dash.err.invalidField');
    case 'too_many_fields':
      return t('dash.err.tooManyFields', { max: String(MAX_FIELDS) });
    case 'invalid_tag':
      return t('dash.err.invalidTag');
    case 'too_many_tags':
      return t('dash.err.tooManyTags', { max: String(MAX_TAGS) });
    case 'unknown_tag_category':
      return t('dash.err.unknownTagCategory');
    case 'invalid_email':
      return t('auth.err.invalidEmail');
    case 'rate_limited':
      return t('auth.err.rateLimited');
    case 'send_failed':
      return t('auth.err.sendFailed');
    case 'magic_disabled':
      return t('auth.err.magicDisabled');
    case 'github_unavailable':
      return t('login.githubUnavailable');
    case 'github_taken':
      return t('dash.err.githubTaken');
    case 'email_taken':
      return t('dash.err.emailTaken');
    case 'link_failed':
      return t('dash.err.linkFailed');
    default:
      return undefined;
  }
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function toArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

dashboardRoutes.get('/dashboard', async (c) => {
  const user = c.get('user')!;
  if (!user.username) return c.redirect('/onboarding');

  const t = c.get('t');
  const settings = c.get('settings');
  const [fields, tags, tagCategories, identities] = await Promise.all([
    listFields(c.env.DB, user.id),
    listUserTags(c.env.DB, user.id),
    listTagCategories(c.env.DB),
    listIdentities(c.env.DB, user.id),
  ]);
  const saved = c.req.query('saved');
  const message =
    saved === 'profile'
      ? t('dash.savedProfile')
      : saved === 'fields'
        ? t('dash.savedFields')
        : saved === 'tags'
          ? t('dash.savedTags')
          : saved === 'github_linked'
            ? t('dash.saved.githubLinked')
            : saved === 'email_linked'
              ? t('dash.saved.emailLinked')
              : saved === 'email_sent'
                ? t('dash.saved.emailSent')
                : undefined;

  return c.html(
    <Dashboard
      appName={c.get('appName')}
      faviconUrl={c.get('settings').faviconUrl}
      logoUrl={c.get('settings').logoUrl}
      customCss={c.get('settings').customCss}
      customJs={c.get('settings').customJs}
      customFooter={c.get('settings').customFooter}
      csrfToken={c.get('csrfToken')}
      user={user}
      gravatarUrl={await gravatarAvatarUrl(user.email, resolveGravatarMirror(c.env, settings))}
      fields={fields}
      tags={tags}
      tagCategories={tagCategories}
      identities={identities}
      githubEnabled={githubConfigured(resolveGithub(c.env, settings)) && settings.githubLoginEnabled}
      magicEnabled={settings.magicLinkEnabled}
      message={message}
      error={errorMessage(c.req.query('error'), t)}
      nonce={c.get('secureHeadersNonce')}
      t={t}
      locale={c.get('locale')}
      pathname="/dashboard"
      isAdmin={c.get('isAdmin')}
    />,
  );
});

dashboardRoutes.post('/dashboard/profile', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody();

  const username = normalizeUsername(str(body.username));
  if (!isValidUsername(username)) return c.redirect('/dashboard?error=invalid_username');
  if (await isUsernameReserved(c.env.DB, username)) {
    return c.redirect('/dashboard?error=reserved_username');
  }
  if (await isUsernameTakenByOther(c.env.DB, username, user.id)) {
    return c.redirect('/dashboard?error=taken_username');
  }

  const websiteRaw = text(body.website, 300);
  const avatarRaw = text(body.avatar_url, 500);
  if ((websiteRaw && !isSafeUrl(websiteRaw)) || (avatarRaw && !isSafeUrl(avatarRaw))) {
    return c.redirect('/dashboard?error=invalid_url');
  }

  const theme = text(body.theme, 30);
  const visibility = text(body.visibility, 30);

  const previousUsername = user.username;

  await updateProfile(c.env.DB, user.id, {
    username,
    displayName: text(body.display_name, 80) || null,
    headline: text(body.headline, 120) || null,
    bio: text(body.bio, 1000) || null,
    avatarUrl: avatarRaw || null,
    location: text(body.location, 120) || null,
    website: websiteRaw || null,
    pronouns: text(body.pronouns, 40) || null,
    theme: isTheme(theme) ? theme : 'default',
    visibility: isVisibility(visibility) ? visibility : 'public',
  });

  await invalidateProfiles(c.env.KV, [previousUsername, username]);

  return c.redirect('/dashboard?saved=profile');
});

dashboardRoutes.post('/dashboard/fields', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody({ all: true });

  const labels = toArray(body.label);
  const values = toArray(body.value);

  const fields: FieldInput[] = [];
  for (let i = 0; i < Math.max(labels.length, values.length); i += 1) {
    const label = (labels[i] ?? '').trim();
    const value = (values[i] ?? '').trim();
    if (!label && !value) continue;
    if (!label || !value) return c.redirect('/dashboard?error=invalid_field');

    fields.push({ label: label.slice(0, MAX_FIELD_LABEL), value: value.slice(0, MAX_FIELD_VALUE) });
  }

  if (fields.length > MAX_FIELDS) return c.redirect('/dashboard?error=too_many_fields');

  await replaceFields(c.env.DB, user.id, fields);
  await invalidateProfiles(c.env.KV, [user.username]);
  return c.redirect('/dashboard?saved=fields');
});

dashboardRoutes.post('/dashboard/tags', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.parseBody({ all: true });

  const values = toArray(body.tag);
  const categoryIds = toArray(body.category_id);
  const hiddenFlags = toArray(body.hidden);

  const categories = await listTagCategories(c.env.DB);
  const knownIds = new Set(categories.map((category) => category.id));

  const tags: TagInput[] = [];
  for (let i = 0; i < Math.max(values.length, categoryIds.length); i += 1) {
    const value = (values[i] ?? '').trim();
    const categoryId = (categoryIds[i] ?? '').trim();
    if (!value && !categoryId) continue;
    if (!value || !categoryId) return c.redirect('/dashboard?error=invalid_tag');
    if (!knownIds.has(categoryId)) {
      return c.redirect('/dashboard?error=unknown_tag_category');
    }

    tags.push({
      value: value.slice(0, MAX_TAG_VALUE),
      categoryId,
      hidden: (hiddenFlags[i] ?? '0') === '1',
    });
  }

  if (tags.length > MAX_TAGS) return c.redirect('/dashboard?error=too_many_tags');

  await replaceUserTags(c.env.DB, user.id, tags);
  await invalidateProfiles(c.env.KV, [user.username]);
  return c.redirect('/dashboard?saved=tags');
});

/** Emails a magic link that binds the address to the signed-in account. */
dashboardRoutes.post('/dashboard/identities/email', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  if (!settings.magicLinkEnabled) return c.redirect('/dashboard?error=magic_disabled');

  const body = await c.req.parseBody();
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  if (!isValidEmail(rawEmail)) return c.redirect('/dashboard?error=invalid_email');
  const email = normalizeEmail(rawEmail);

  const owner = await getUserByEmail(c.env.DB, email);
  if (owner && owner.id !== user.id) return c.redirect('/dashboard?error=email_taken');

  const ip = clientIp(c.req.raw.headers);
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(c.env.KV, `email:ip:${ip}`, 10, 3600),
    rateLimit(c.env.KV, `email:addr:${email}`, 5, 3600),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return c.redirect('/dashboard?error=rate_limited');
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await createLoginToken(c.env.DB, {
    tokenHash,
    email,
    expiresAt: Date.now() + LINK_TTL_SECONDS * 1000,
  });
  await c.env.KV.put(`link:email:${tokenHash}`, user.id, { expirationTtl: LINK_TTL_SECONDS });

  const link = `${appUrl(c.env)}/auth/email/verify?token=${encodeURIComponent(token)}`;
  try {
    await getMailer(resolveMailer(c.env, c.get('settings'))).send({
      to: email,
      ...magicLinkEmail(c.get('t'), link, c.get('appName')),
    });
  } catch (error) {
    console.error('Account link email failed', error);
    return c.redirect('/dashboard?error=send_failed');
  }

  return c.redirect('/dashboard?saved=email_sent');
});

/** AI assistant: streams a chat completion back to the dashboard over SSE. */
dashboardRoutes.post('/dashboard/ai/chat', async (c) => {
  const user = c.get('user')!;
  const settings = c.get('settings');
  const t = c.get('t');

  const resolved = resolveOpenAI(c.env, settings);
  if (!resolved) {
    return c.json({ error: t('dash.ai.notConfigured') }, 503);
  }

  const body = await c.req.parseBody();
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(typeof body.messages === 'string' ? body.messages : '[]');
  } catch {
    parsed = [];
  }

  const history: ChatCompletionMessageParam[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const role = (entry as { role?: unknown }).role;
      const content = (entry as { content?: unknown }).content;
      if (typeof content !== 'string') continue;
      const trimmed = content.trim().slice(0, 4000);
      if (!trimmed) continue;
      if (role === 'user') history.push({ role: 'user', content: trimmed });
      else if (role === 'assistant') history.push({ role: 'assistant', content: trimmed });
    }
  }

  if (history.length === 0) {
    return c.json({ error: t('dash.ai.error') }, 400);
  }

  // Prefer the caller's current (possibly unsaved) form content, which the
  // dashboard sends as `profile`; fall back to the stored profile when absent.
  let clientProfile: Record<string, unknown> = {};
  try {
    const raw = typeof body.profile === 'string' ? JSON.parse(body.profile) : null;
    if (raw && typeof raw === 'object') clientProfile = raw as Record<string, unknown>;
  } catch {
    clientProfile = {};
  }

  const value = (key: string, fallback: string): string => {
    const raw = clientProfile[key];
    const text = typeof raw === 'string' ? raw.trim().slice(0, 1000) : '';
    return text || fallback || '(empty)';
  };

  const lines = [
    `display name: ${value('display_name', user.display_name ?? '')}`,
    `headline: ${value('headline', user.headline ?? '')}`,
    `bio: ${value('bio', user.bio ?? '')}`,
    `location: ${value('location', user.location ?? '')}`,
    `website: ${value('website', user.website ?? '')}`,
    `pronouns: ${value('pronouns', user.pronouns ?? '')}`,
  ];

  const clientFields = Array.isArray(clientProfile.fields) ? clientProfile.fields : [];
  const fieldLines = clientFields
    .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
    .map((field) =>
      `${String(field.label ?? '').slice(0, 40)}: ${String(field.value ?? '').slice(0, 300)}`.trim(),
    )
    .filter((line) => line.length > 1)
    .slice(0, 20);
  if (fieldLines.length) lines.push('fields:', ...fieldLines.map((line) => `- ${line}`));

  const clientTags = Array.isArray(clientProfile.tags) ? clientProfile.tags : [];
  const tagValues = clientTags
    .filter((tag): tag is Record<string, unknown> => Boolean(tag) && typeof tag === 'object')
    .map((tag) => {
      const label = String(tag.value ?? '').slice(0, 40).trim();
      const category = String(tag.category ?? '').slice(0, 40).trim();
      if (!label) return '';
      return category ? `${category}: ${label}` : label;
    })
    .filter(Boolean)
    .slice(0, 20);
  if (tagValues.length) lines.push(`tags: ${tagValues.join(', ')}`);

  const profile = lines.join('\n');
  const system = `${settings.openaiPromptChat || DEFAULT_CHAT_PROMPT}\n\nThe user's current profile:\n${profile}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      try {
        const completion = await resolved.client.chat.completions.create({
          model: resolved.model,
          messages: [{ role: 'system', content: system }, ...history.slice(-20)],
          stream: true,
          temperature: 0.7,
        });
        for await (const chunk of completion) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) send({ delta });
        }
        send({ done: true });
      } catch (error) {
        console.error('AI chat stream error:', error);
        send({ error: t('dash.ai.error') });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
});
