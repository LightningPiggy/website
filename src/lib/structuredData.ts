// structuredData.ts
// JSON-LD nodes shared across the site. BaseLayout puts them, plus any
// page-specific nodes, into one @graph and serialises it with safeJsonLd, so
// nodes on the same page can point at each other by @id.
import { socialLinks } from '../data/social';

export const SITE_URL = 'https://lightningpiggy.com/';
export const ORG_ID = `${SITE_URL}#organization`;
export const WEBSITE_ID = `${SITE_URL}#website`;

const NAME = 'Lightning Piggy';

// Google: at least 112x112, crawlable, looks right on white. The square app
// icon is the mascot on yellow, 512x512 and a third of the size of mascot.png.
const LOGO = {
  '@type': 'ImageObject',
  url: `${SITE_URL}icon-512.png`,
  width: 512,
  height: 512,
};

export const organization = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: NAME,
  alternateName: 'LightningPiggy',
  url: SITE_URL,
  logo: LOGO,
  description: 'An open source Bitcoin piggy bank for families. Save in satoshis over the Lightning Network.',
  email: 'oink@lightningpiggy.com',
  sameAs: socialLinks.map((l) => l.href),
};

// Site name in Google results. Home page only (Google reads it nowhere else).
export const website = {
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: NAME,
  alternateName: ['LightningPiggy', 'lightningpiggy.com'],
  url: SITE_URL,
  inLanguage: 'en-GB',
  publisher: { '@id': ORG_ID },
};

// Author / publisher of the site's own posts: the organisation, spelled out
// in full (not just an @id) so readers that don't resolve references still
// get a name and url.
export const orgRef = { '@type': 'Organization', '@id': ORG_ID, name: NAME, url: SITE_URL };
export const publisherRef = { ...orgRef, logo: LOGO };

// Breadcrumb trails for pages one level below a section. The parent is where
// the header menu puts the page, not just the first URL segment: the help
// pages live under /help/ but are reached from the Help section of /build/.
const SECTIONS: Record<string, { name: string; path: string }> = {
  about: { name: 'About', path: '/about/' },
  build: { name: 'Build', path: '/build/' },
  community: { name: 'Community', path: '/community/' },
  help: { name: 'Help', path: '/build/#help' },
  market: { name: 'Market', path: '/market/' },
  news: { name: 'News', path: '/news/' },
};

export function breadcrumbList(pathname: string, title: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const section = SECTIONS[segments[0]];
  if (!section) return null;
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: section.name, item: new URL(section.path, SITE_URL).href },
      // Last crumb: no item, so Google uses this page's own URL.
      { '@type': 'ListItem', position: 3, name: title },
    ],
  };
}
