/** Landing page for signed-out visitors (a shortcut for users). */
import type { MessageKey, TranslateFn } from '../i18n';
import type { LandingCopy, LandingCopyKey } from '../lib/settings';

export interface HomeProps {
  appName: string;
  t: TranslateFn;
  copy: LandingCopy;
  ctaPrimaryUrl: string;
  ctaSecondaryUrl: string;
  loggedIn?: boolean;
}

export function Home({ appName, t, copy, ctaPrimaryUrl, ctaSecondaryUrl, loggedIn }: HomeProps) {
  // Admin overrides win over the built-in copy; a blank field falls back to the
  // translated `home.*` message for the current locale.
  const at = (key: LandingCopyKey) => copy[key].trim() || t(`home.${key}` as MessageKey);
  const subtitle = at('subtitle').replaceAll('{appName}', appName);
  // Button targets: a configured link wins; blank restores the default behavior
  // (primary → /login, or /dashboard when signed in; secondary → #how).
  const primaryUrl = ctaPrimaryUrl.trim();
  const primaryHref = primaryUrl || (loggedIn ? '/dashboard' : '/login');
  const primaryLabel = loggedIn && !primaryUrl ? t('nav.dashboard') : at('ctaClaim');
  const secondaryHref = ctaSecondaryUrl.trim() || '#how';
  const steps = [
    { title: at('step1Title'), body: at('step1Body') },
    { title: at('step2Title'), body: at('step2Body') },
    { title: at('step3Title'), body: at('step3Body') },
  ];

  return (
    <section class="flex flex-col items-start gap-10 py-6">
      <span class="chip border border-primary/30 bg-primary/10 text-primary">
        <span class="h-1.5 w-1.5 rounded-full bg-primary" />
        {at('badge')}
      </span>

      <div class="space-y-5">
        <h1 class="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          {at('heroLead')}
          <span class="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            {at('heroAccent')}
          </span>
          {at('heroTail')}
        </h1>
        <p class="max-w-2xl text-lg text-muted-foreground">{subtitle}</p>
      </div>

      <div class="flex flex-wrap gap-3">
        <a href={primaryHref} class="btn-primary px-6 py-3 text-base">
          {primaryLabel}
        </a>
        <a href={secondaryHref} class="btn-outline px-6 py-3 text-base">
          {at('ctaHow')}
        </a>
      </div>

      <div id="how" class="grid w-full gap-4 pt-6 sm:grid-cols-3">
        {steps.map((step) => (
          <div class="card p-6">
            <h3 class="font-semibold">{step.title}</h3>
            <p class="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
