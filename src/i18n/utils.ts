// Translation helpers.
//
// Usage in a component:
//   const lang = getLangFromUrl(Astro.url);
//   const t = useTranslations(lang);
//   <h1>{t('home.hero.title')}</h1>
//
// Missing keys fall back to English rather than rendering a raw key, so a
// half-translated locale degrades to English copy instead of `home.hero.title`.

import { DEFAULT_LOCALE, isLocale, LOCALE_CODES, LOCALIZED_ROUTES, type Locale } from './config';
import { ui } from './ui';

// The locale is the first path segment (`/de/build` -> `de`); anything else is
// the default locale, which is served un-prefixed.
export function getLangFromUrl(url: URL): Locale {
  const [, first] = url.pathname.split('/');
  return first && isLocale(first) ? first : DEFAULT_LOCALE;
}

export function useTranslations(lang: Locale) {
  return function t(key: string): string {
    const dict = ui[lang] as Record<string, string> | undefined;
    const fallback = ui[DEFAULT_LOCALE] as Record<string, string>;
    return dict?.[key] ?? fallback[key] ?? key;
  };
}

// Prefix an app-relative path with the current locale. `/build` becomes
// `/de/build` for German and stays `/build` for English. External links,
// anchors and mailto: are returned untouched.
export function localizePath(path: string, lang: Locale): string {
  if (!path.startsWith('/')) return path; // #anchor, https://, mailto:
  if (lang === DEFAULT_LOCALE) return path;
  // Only prefix routes that actually exist in this locale. While the site is
  // being localised page by page, everything else keeps pointing at the English
  // page — a working link in the wrong language beats a 404 in the right one.
  const [base] = path.split('#');
  if (!LOCALIZED_ROUTES.has(base)) return path;
  // Keep the trailing slash on the locale root: the page is served at `/nl/`,
  // so emitting `/nl` would cost every crawler and visitor a redirect hop.
  return base === '/' ? `/${lang}/` : `/${lang}${path}`;
}

// Strip the locale prefix from a pathname, giving the canonical English path.
// Used by the language picker so switching language keeps you on the same page.
export function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split('/');
  if (first && isLocale(first) && first !== DEFAULT_LOCALE) {
    return '/' + rest.join('/');
  }
  return pathname;
}

// hreflang alternates for <head>. Includes x-default pointing at English,
// which is what search engines use for unmatched languages.
export function getAlternates(url: URL, site: URL | undefined) {
  const base = site ?? new URL('https://lightningpiggy.com');
  const canonicalPath = stripLocale(url.pathname);
  const alternates = LOCALE_CODES.map((code) => ({
    hreflang: code,
    href: new URL(localizePath(canonicalPath, code), base).href,
  }));
  alternates.push({ hreflang: 'x-default', href: new URL(canonicalPath, base).href });
  return alternates;
}
