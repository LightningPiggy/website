// Locale registry for the site.
//
// English is the default and stays un-prefixed at `/`; every other locale is
// served from `/<code>/`. `label` is what the language picker shows (always in
// the target language, so a Korean visitor recognises 한국어 without reading
// English), and `ogLocale` feeds the OpenGraph tag.
export const DEFAULT_LOCALE = 'en' as const;

export const LOCALES = {
  en: { label: 'English', ogLocale: 'en_GB', dir: 'ltr' },
  nl: { label: 'Nederlands', ogLocale: 'nl_NL', dir: 'ltr' },
  de: { label: 'Deutsch', ogLocale: 'de_DE', dir: 'ltr' },
  es: { label: 'Español', ogLocale: 'es_ES', dir: 'ltr' },
  pt: { label: 'Português', ogLocale: 'pt_BR', dir: 'ltr' },
  ko: { label: '한국어', ogLocale: 'ko_KR', dir: 'ltr' },
} as const;

export type Locale = keyof typeof LOCALES;

export const LOCALE_CODES = Object.keys(LOCALES) as Locale[];

// The locales that need a URL prefix (everything except the default).
export const PREFIXED_LOCALES = LOCALE_CODES.filter((l) => l !== DEFAULT_LOCALE);

export function isLocale(value: string): value is Locale {
  return (LOCALE_CODES as string[]).includes(value);
}

// Paths that have a matching route under src/pages/[lang]/.
//
// The site is being localised page by page, so this is the guard that keeps it
// shippable in between: localizePath() only adds a locale prefix for paths
// listed here, and links to everything else stay on the English page rather
// than pointing at a URL that doesn't exist yet. Add a path here in the same
// commit that adds its src/pages/[lang]/ route.
export const LOCALIZED_ROUTES = new Set<string>([
  '/',
  '/about',
  '/build',
  '/community',
  '/community/bitcoinkids',
  '/community/branding',
  '/community/credits',
  '/community/educators',
  '/community/wild',
  '/community/zapmypiggy',
  '/help/faqs',
  '/help/serial-monitor',
  '/help/troubleshooting',
  '/market',
]);
