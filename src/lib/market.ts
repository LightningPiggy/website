// market.ts
// Isomorphic (browser + Node) helpers for the Nostr-native market: NIP-99
// (kind 30402) / NIP-15 (kind 30018) product parsing, vendor-profile (kind 0)
// shaping, and the card HTML renderers. Kept free of any DOM / WebSocket / `ws`
// reference so the SAME parsing + rendering runs at build time (to prerender a
// static, SEO-visible snapshot in the .astro frontmatter) AND on the client
// (to refresh the snapshot live). The relay fetch itself is environment
// specific: see marketServer.ts (Node, build) and each component's <script>
// (browser).

export const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];

export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

// A product as rendered in the grid. priceAmount/priceCurrency are the raw
// values (for JSON-LD); `price` is the display string. `productUrl` is the
// internal detail page (/market/p/<slug>); `storeUrl` is the vendor's external
// store (used as a fallback / for the detail page's "buy on vendor store").
export interface Product {
  title: string;
  price: string;
  priceAmount: string;
  priceCurrency: string;
  image: string;
  summary: string;
  storeUrl: string;
  productUrl: string;
  vendor: string;
  vendorLogo: string;
  createdAt: number;
}

// The full product used to render a detail page (/market/p/<slug>). Mirrors the
// NIP-99 (kind 30402) / NIP-15 (kind 30018) event as closely as the reference
// robotechy-website ProductData does, so per-product pages have images, specs,
// a long description, etc. Built at build time in the [slug].astro getStaticPaths.
export interface ProductDetail {
  pubkey: string; // hex author (vendor)
  dtag: string; // 'd' tag (stable product id)
  kind: number; // 30402 or 30018
  coord: string; // addressable coordinate: `<kind>:<pubkey>:<dtag>`
  title: string;
  summary: string;
  description: string; // long-form body (event content for 30402)
  price: string; // display string, e.g. "£29"
  priceAmount: string; // raw amount
  priceCurrency: string; // upper-cased currency code
  images: string[]; // sanitized image URLs (first is primary)
  specs: [string, string][]; // 'spec' tag key/value pairs
  categories: string[]; // 't' tag hashtags
  location: string; // 'location' tag
  stock: string; // 'stock' tag ('' = unspecified/unlimited)
  createdAt: number;
}

export interface VendorProduct {
  title: string;
  price: string;
  image: string;
  summary: string;
}

export interface VendorView {
  name: string;
  picture: string;
  about: string;
  nip05: string;
  lud16: string;
  website: string;
  storeUrl: string;
  npub: string;
  shopType: string;
  location: string;
  featured: boolean;
  products: VendorProduct[];
}

export interface Shop {
  name: string;
  storeUrl: string;
  logo: string;
  npub: string;
  mode: string;
  include: string[];
  keywords: string[];
}

export interface Seed {
  npub: string;
  fallbackName: string;
  fallbackLogo: string;
  fallbackAbout: string;
  storeUrl: string;
  shopType: string;
  location: string;
  featured: boolean;
  mode: string;
  include: string[];
  keywords: string[];
}

// ---------- helpers ----------
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export function npubToHex(npub: string): string {
  if (!npub || !npub.startsWith('npub1')) return '';
  const pos = npub.lastIndexOf('1');
  const data: number[] = [];
  for (const c of npub.slice(pos + 1)) {
    const i = BECH32.indexOf(c);
    if (i === -1) return '';
    data.push(i);
  }
  const values = data.slice(0, -6);
  let acc = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const v of values) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// String-based escape so it works server-side too (no `document`). Escapes
// quotes as well, so values are safe inside HTML attributes.
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url: string): string {
  try {
    const p = new URL(url);
    if (p.protocol === 'http:' || p.protocol === 'https:') return url;
  } catch {}
  return '';
}

export const tagVal = (t: string[][], k: string): string | undefined =>
  t.find((x) => x[0] === k)?.[1];
export const tagsAll = (t: string[][], k: string): string[] =>
  t.filter((x) => x[0] === k).map((x) => x[1]);

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
  SAT: '⚡',
  SATS: '⚡',
};
export function formatPrice(t: string[][]): string {
  const p = t.find((x) => x[0] === 'price');
  if (!p || !p[1]) return '';
  const cur = (p[2] || '').toUpperCase();
  const a = p[1].replace(/\.00$/, '');
  return CURRENCY_SYMBOL[cur] ? `${CURRENCY_SYMBOL[cur]}${a}` : cur ? `${a} ${cur}` : a;
}

// NostrShop's stricter test/staging filter.
export function isTestProduct(title: string, d: string): boolean {
  const s = (title + ' ' + d).toLowerCase();
  return /\b(localhost|staging)\b/.test(s) || /staging|localhost/.test(d.toLowerCase());
}

// NostrMarket's broader test/staging filter.
export function isTest(title: string, d: string): boolean {
  return /\b(localhost|staging|test|demo|sample)\b/i.test(title + ' ' + d);
}

export function matchesShop(ev: NostrEvent, shop: Shop): boolean {
  const d = tagVal(ev.tags, 'd') || '';
  const title = tagVal(ev.tags, 'title') || '';
  if (!d || !title) return false;
  if (isTestProduct(title, d)) return false;
  if (shop.mode === 'curated') return shop.include.includes(d);
  if (shop.mode === 'keywords') {
    const hay = (
      title +
      ' ' +
      (tagVal(ev.tags, 'summary') || ev.content || '') +
      ' ' +
      tagsAll(ev.tags, 't').join(' ')
    ).toLowerCase();
    return shop.keywords.some((k) => hay.includes(k.toLowerCase()));
  }
  return true; // 'all'
}

export function productMatches(ev: NostrEvent, seed: Seed): boolean {
  const d = tagVal(ev.tags, 'd') || '';
  const title = tagVal(ev.tags, 'title') || '';
  if (!d || !title || isTest(title, d)) return false;
  const inInclude = seed.include.includes(d);
  const kwHay = (
    title +
    ' ' +
    (tagVal(ev.tags, 'summary') || ev.content || '') +
    ' ' +
    tagsAll(ev.tags, 't').join(' ')
  ).toLowerCase();
  const kwMatch = seed.keywords.some((k) => kwHay.includes(k.toLowerCase()));
  if (seed.mode === 'curated') return inInclude || kwMatch;
  if (seed.mode === 'keywords') return kwMatch;
  return true; // 'all'
}

// ---------- slugs / vendor shaping ----------
// URL-safe kebab-case slug from arbitrary text.
export function kebab(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Stable, unique-per-product slug for the /market/p/<slug> detail page. Keyed on
// the vendor name + the product's `d` tag (stable id), so it doesn't change when
// the title is edited.
export function productSlug(vendorName: string, dtag: string): string {
  return `${kebab(vendorName)}--${kebab(dtag)}`;
}

// Shape src/data/vendors.json entries into the Shop list the shop grid + product
// pages both consume. Only vendors that opt in with a `products` block and have
// an npub are included. Reads the store address from `url` (the field name used
// in vendors.json).
export function shopsFromVendors(vendors: any[]): Shop[] {
  return (vendors || [])
    .filter((v) => v && v.products && v.nostrUrl)
    .map((v) => ({
      name: v.name,
      storeUrl: v.url || '',
      logo: v.logo || '',
      npub: (String(v.nostrUrl).match(/npub1[0-9a-z]+/) || [])[0] || '',
      mode: v.products.mode || 'curated',
      include: v.products.include || [],
      keywords: v.products.keywords || [],
    }))
    .filter((s) => s.npub);
}

// ---------- transforms (events -> view models) ----------
// Select the newest, matching, de-duplicated product events for each shop, in
// display order. Shared by buildShopProducts (grid) and the [slug].astro
// getStaticPaths (detail pages) so the two never disagree about which products
// exist or how they're keyed.
export function selectShopEvents(
  events: NostrEvent[],
  shops: Shop[],
): { ev: NostrEvent; shop: Shop }[] {
  const newest = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== 30402 && ev.kind !== 30018) continue;
    const d = tagVal(ev.tags, 'd') || '';
    const key = `${ev.kind}:${ev.pubkey}:${d}`;
    const ex = newest.get(key);
    if (!ex || ev.created_at > ex.created_at) newest.set(key, ev);
  }

  const out: { ev: NostrEvent; shop: Shop }[] = [];
  const seenTitles = new Set<string>();
  const evList = [...newest.values()];
  for (const shop of shops) {
    const hex = npubToHex(shop.npub);
    const mine = evList.filter((ev) => ev.pubkey === hex && matchesShop(ev, shop));
    const order = (ev: NostrEvent) =>
      shop.mode === 'curated' ? shop.include.indexOf(tagVal(ev.tags, 'd') || '') : 0;
    mine.sort((a, b) => order(a) - order(b) || b.created_at - a.created_at);
    for (const ev of mine) {
      const title = tagVal(ev.tags, 'title') || '';
      const titleKey = `${hex}:${title.toLowerCase()}`;
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      out.push({ ev, shop });
    }
  }
  return out;
}

// Build the flat product grid (NostrShop). Mirrors the client init() exactly so
// build-time and live renders agree.
export function buildShopProducts(events: NostrEvent[], shops: Shop[]): Product[] {
  return selectShopEvents(events, shops).map(({ ev, shop }) => {
    const priceTag = ev.tags.find((x) => x[0] === 'price');
    const dtag = tagVal(ev.tags, 'd') || '';
    return {
      title: tagVal(ev.tags, 'title') || '',
      price: formatPrice(ev.tags),
      priceAmount: priceTag?.[1] || '',
      priceCurrency: (priceTag?.[2] || '').toUpperCase(),
      image: sanitizeUrl(tagVal(ev.tags, 'image') || ''),
      summary: tagVal(ev.tags, 'summary') || ev.content || '',
      storeUrl: shop.storeUrl,
      productUrl: `/market/p/${productSlug(shop.name, dtag)}`,
      vendor: shop.name,
      vendorLogo: sanitizeUrl(shop.logo) || (shop.logo.startsWith('/') ? shop.logo : ''),
      createdAt: ev.created_at,
    };
  });
}

// Parse a product event into the full ProductDetail used by the detail page.
// Tolerant of both NIP-99 (kind 30402, tag-based) and NIP-15 (kind 30018,
// JSON-in-content) shapes.
export function parseProductDetail(ev: NostrEvent): ProductDetail {
  const dtag = tagVal(ev.tags, 'd') || '';
  const priceTag = ev.tags.find((x) => x[0] === 'price');

  // NIP-15 (30018) carries the bulk of its data as JSON in content.
  let json: any = {};
  if (ev.kind === 30018) {
    try {
      json = JSON.parse(ev.content) || {};
    } catch {}
  }

  const images = tagsAll(ev.tags, 'image')
    .map(sanitizeUrl)
    .filter(Boolean);
  if (!images.length) {
    const fromJson = Array.isArray(json.images)
      ? json.images
      : json.image
        ? [json.image]
        : [];
    for (const u of fromJson) {
      const s = sanitizeUrl(u);
      if (s) images.push(s);
    }
  }

  const specs = ev.tags
    .filter((t) => t[0] === 'spec' && t[1])
    .map((t) => [t[1], t[2] || ''] as [string, string]);

  return {
    pubkey: ev.pubkey,
    dtag,
    kind: ev.kind,
    coord: `${ev.kind}:${ev.pubkey}:${dtag}`,
    title: tagVal(ev.tags, 'title') || json.name || 'Untitled product',
    summary: tagVal(ev.tags, 'summary') || json.summary || '',
    description: ev.kind === 30018 ? json.description || '' : ev.content || '',
    price: formatPrice(ev.tags) || (json.price ? String(json.price) : ''),
    priceAmount: priceTag?.[1] || (json.price != null ? String(json.price) : ''),
    priceCurrency: (priceTag?.[2] || json.currency || '').toUpperCase(),
    // De-dupe identical image URLs (some listings repeat the same `image` tag).
    images: [...new Set(images)],
    specs,
    categories: tagsAll(ev.tags, 't'),
    location: tagVal(ev.tags, 'location') || '',
    stock: tagVal(ev.tags, 'stock') || (json.quantity != null ? String(json.quantity) : ''),
    createdAt: ev.created_at,
  };
}

// Build the vendor cards (NostrMarket). Mirrors the client init() exactly.
export function buildVendorViews(
  events: NostrEvent[],
  seeds: Seed[],
  showProducts: boolean,
): VendorView[] {
  const profiles = new Map<string, NostrEvent>();
  const products = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind === 0) {
      const ex = profiles.get(ev.pubkey);
      if (!ex || ev.created_at > ex.created_at) profiles.set(ev.pubkey, ev);
    } else {
      const key = `${ev.kind}:${ev.pubkey}:${tagVal(ev.tags, 'd') || ''}`;
      const ex = products.get(key);
      if (!ex || ev.created_at > ex.created_at) products.set(key, ev);
    }
  }

  const views: VendorView[] = [];
  for (const seed of seeds) {
    const hex = npubToHex(seed.npub);
    let p: any = {};
    const prof = hex ? profiles.get(hex) : undefined;
    if (prof) {
      try {
        p = JSON.parse(prof.content);
      } catch {}
    }
    const mine =
      hex && showProducts
        ? [...products.values()].filter((ev) => ev.pubkey === hex && productMatches(ev, seed))
        : [];
    const order = (ev: NostrEvent) =>
      seed.mode === 'curated' ? seed.include.indexOf(tagVal(ev.tags, 'd') || '') : 0;
    mine.sort((a, b) => {
      const oa = order(a);
      const ob = order(b);
      const ra = oa === -1 ? 999 : oa;
      const rb = ob === -1 ? 999 : ob;
      return ra - rb || b.created_at - a.created_at;
    });
    const seen = new Set<string>();
    const prodList: VendorProduct[] = [];
    for (const ev of mine) {
      const title = tagVal(ev.tags, 'title') || '';
      if (seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      prodList.push({
        title,
        price: formatPrice(ev.tags),
        image: sanitizeUrl(tagVal(ev.tags, 'image') || ''),
        summary: tagVal(ev.tags, 'summary') || ev.content || '',
      });
    }

    views.push({
      name: p.display_name || p.name || seed.fallbackName,
      picture: sanitizeUrl(p.picture || '') || seed.fallbackLogo,
      about: p.about || seed.fallbackAbout || '',
      nip05: p.nip05 || '',
      lud16: p.lud16 || p.lud06 || '',
      website: sanitizeUrl(p.website || '') || seed.storeUrl,
      storeUrl: seed.storeUrl || sanitizeUrl(p.website || ''),
      npub: seed.npub,
      shopType: seed.shopType,
      location: seed.location,
      featured: seed.featured,
      products: prodList,
    });
  }

  views.sort((a, b) => Number(b.featured) - Number(a.featured));
  return views;
}

// ---------- renderers (return HTML strings; identical on build + client) ----------
export function shopCardHtml(p: Product): string {
  const img = p.image
    ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" loading="lazy" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.style.display='none'">`
    : `<div class="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">No image</div>`;
  const price = p.price
    ? `<span class="text-pink font-bold whitespace-nowrap">${escapeHtml(p.price)}</span>`
    : '';
  const logo = p.vendorLogo
    ? `<img src="${escapeHtml(p.vendorLogo)}" alt="${escapeHtml(p.vendor)}" referrerpolicy="no-referrer" class="w-5 h-5 rounded-full object-cover flex-shrink-0" onerror="this.style.display='none'">`
    : `<span class="w-5 h-5 rounded-full bg-pink/10 text-pink text-[10px] font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(
        (p.vendor || '?').charAt(0).toUpperCase(),
      )}</span>`;
  // Prefer the internal product detail page; fall back to the vendor store URL
  // (external) only if we somehow have no product URL.
  const internal = !!p.productUrl;
  const href = p.productUrl || p.storeUrl;
  const linkAttrs = internal ? '' : ' target="_blank" rel="noopener noreferrer"';
  const cta = internal ? 'View' : 'Buy';
  return `
      <a href="${escapeHtml(href)}"${linkAttrs} data-vendor="${escapeHtml(p.vendor)}"
         class="group flex flex-col bg-white rounded-2xl border border-gray-200 overflow-hidden transition-all hover:border-pink hover:shadow-lg">
        <div class="relative aspect-square bg-gray-50 overflow-hidden">${img}</div>
        <div class="flex flex-col flex-1 p-4">
          <div class="flex items-start justify-between gap-2">
            <h3 class="font-semibold text-gray-900 leading-snug line-clamp-2">${escapeHtml(p.title)}</h3>
            ${price}
          </div>
          <p class="text-sm text-gray-500 mt-1 line-clamp-2 flex-1">${escapeHtml(p.summary.slice(0, 120))}</p>
          <div class="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
            ${logo}
            <span class="text-xs text-gray-500 truncate flex-1">${escapeHtml(p.vendor)}</span>
            <span class="inline-flex items-center gap-1 text-sm font-semibold text-pink group-hover:gap-2 transition-all whitespace-nowrap">
              ${cta}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </span>
          </div>
        </div>
      </a>`;
}

export function productCardHtml(p: VendorProduct, storeUrl: string): string {
  const img = p.image
    ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" loading="lazy" referrerpolicy="no-referrer" class="absolute inset-0 w-full h-full object-cover group-hover/p:scale-105 transition-transform duration-500">`
    : `<div class="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">No image</div>`;
  const price = p.price
    ? `<span class="text-pink font-bold text-sm whitespace-nowrap">${escapeHtml(p.price)}</span>`
    : '';
  return `
      <a href="${escapeHtml(storeUrl)}" target="_blank" rel="noopener noreferrer"
         class="group/p block bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-pink hover:shadow-md transition-all">
        <div class="relative aspect-square bg-gray-50 overflow-hidden">${img}</div>
        <div class="p-3">
          <div class="flex items-start justify-between gap-2">
            <h4 class="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">${escapeHtml(p.title)}</h4>
            ${price}
          </div>
        </div>
      </a>`;
}

export function vendorHtml(v: VendorView, showProducts: boolean): string {
  const avatar = v.picture
    ? `<img src="${escapeHtml(v.picture)}" alt="${escapeHtml(v.name)}" referrerpolicy="no-referrer" class="block w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const initial = `<div class="w-full h-full bg-pink/10 items-center justify-center text-pink text-2xl font-bold ${
    v.picture ? 'hidden' : 'flex'
  }">${escapeHtml((v.name || '?').charAt(0).toUpperCase())}</div>`;
  const nip05 = v.nip05
    ? `<span class="inline-flex items-center gap-1 text-xs text-gray-500"><svg class="w-3.5 h-3.5 text-pink" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>${escapeHtml(
        v.nip05.replace(/^_@/, ''),
      )}</span>`
    : '';
  const website = v.website
    ? `<a href="${escapeHtml(v.website)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm font-semibold text-gray-700 hover:text-pink"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M3.6 9h16.8 M3.6 15h16.8 M12 3a15 15 0 010 18 M12 3a15 15 0 000 18"/></svg>Visit store</a>`
    : '';
  const zap = v.lud16
    ? `<button type="button" class="zap-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow text-gray-900 text-sm font-semibold hover:brightness-95 transition" data-lud16="${escapeHtml(
        v.lud16,
      )}" data-name="${escapeHtml(v.name)}">
           <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11 21h-1l1-7H6.74a.6.6 0 01-.5-.92L13 3h1l-1 7h4.26a.6.6 0 01.5.92L11 21z"/></svg>Zap</button>`
    : '';
  const products =
    showProducts && v.products.length > 0
      ? `<div class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">${v.products
          .map((p) => productCardHtml(p, v.storeUrl))
          .join('')}</div>`
      : '';
  const shopLabel =
    v.shopType === 'physical' ? 'Physical' : v.shopType === 'both' ? 'Online & Physical' : 'Online';
  const meta = [v.location, shopLabel].filter(Boolean).join(' · ');
  const featuredRibbon = v.featured
    ? `<span class="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-gray-800 bg-yellow/40 px-2.5 py-1 rounded-full">★ Pride of the Market</span>`
    : '';
  const cardClass = v.featured
    ? 'border-yellow ring-1 ring-yellow/50 shadow-[0_0_28px_2px_rgba(255,219,0,0.45)]'
    : 'border-gray-200 hover:border-pink/50 hover:shadow-md';
  return `
      <div class="rounded-2xl border ${cardClass} bg-white p-6 transition-all">
        <div class="flex items-start gap-4">
          <div class="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-100">${avatar}${initial}</div>
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 class="text-xl font-bold text-gray-900">${escapeHtml(v.name)}</h3>
              ${featuredRibbon}
            </div>
            ${meta ? `<p class="text-xs text-gray-500 mt-0.5">${escapeHtml(meta)}</p>` : ''}
            ${v.nip05 ? `<div class="mt-1">${nip05}</div>` : ''}
            ${v.about ? `<p class="text-sm text-gray-600 mt-2 line-clamp-2">${escapeHtml(v.about)}</p>` : ''}
            <div class="flex flex-wrap items-center gap-3 mt-3">${website}${zap}</div>
          </div>
        </div>
        ${products}
      </div>`;
}

// JSON-LD ItemList of Products for SEO (build-time only).
export function productsJsonLd(products: Product[], pageUrl: string): string {
  const items = products.map((p, i) => {
    const item: any = {
      '@type': 'Product',
      name: p.title,
      ...(p.image ? { image: p.image } : {}),
      ...(p.summary ? { description: p.summary.slice(0, 300) } : {}),
      ...(p.vendor ? { brand: { '@type': 'Brand', name: p.vendor } } : {}),
    };
    if (p.priceAmount) {
      item.offers = {
        '@type': 'Offer',
        price: p.priceAmount,
        ...(p.priceCurrency && p.priceCurrency !== 'SAT' && p.priceCurrency !== 'SATS'
          ? { priceCurrency: p.priceCurrency }
          : {}),
        ...(p.storeUrl ? { url: p.storeUrl } : {}),
        availability: 'https://schema.org/InStock',
      };
    }
    return { '@type': 'ListItem', position: i + 1, item };
  });
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Lightning Piggy Market',
    url: pageUrl,
    numberOfItems: products.length,
    itemListElement: items,
  });
}
