/**
 * Dashboard sub-module registry — the single source of truth for the
 * sidebar's second-level dashboard menu and the section routes (see
 * `src/routes/dashboard.tsx`). Every entry gets its own `GET /dashboard/...`
 * page; form posts redirect back to the same page.
 */
import type { MessageKey } from '../i18n';

export type DashboardSection =
  | 'profile'
  | 'fields'
  | 'tags'
  | 'security'
  | 'ai';

/** URL of each section's page. `/dashboard` itself stays the alias for
 *  `profile` (external links and sign-in redirects still land there). */
export const DASHBOARD_SECTION_PATH: Record<DashboardSection, string> = {
  profile: '/dashboard',
  fields: '/dashboard/fields',
  tags: '/dashboard/tags',
  security: '/dashboard/security',
  ai: '/dashboard/ai',
};

/** Sidebar entries in display order. `overview`-style quick-link cards on the
 *  profile page skip the entry whose page is the current one. */
export const DASHBOARD_SECTIONS: readonly {
  section: DashboardSection;
  path: string;
  key: MessageKey;
  icon: string;
}[] = [
  { section: 'profile', path: '/dashboard', key: 'dash.nav.profile', icon: 'badge' },
  { section: 'fields', path: '/dashboard/fields', key: 'dash.nav.fields', icon: 'list_alt' },
  { section: 'tags', path: '/dashboard/tags', key: 'dash.nav.tags', icon: 'sell' },
  { section: 'security', path: '/dashboard/security', key: 'dash.nav.security', icon: 'verified_user' },
  { section: 'ai', path: '/dashboard/ai', key: 'dash.nav.ai', icon: 'smart_toy' },
];
