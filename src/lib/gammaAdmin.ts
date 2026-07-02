// gammaAdmin.ts
// Pure builders / parsers / validation for vendor management of a Gamma Markets
// (NIP-99) shop on Nostr. Covers the three addressable event kinds a vendor
// manages, plus NIP-09 deletion:
//   • products         — kind 30402
//   • categories       — kind 30405 (collections)
//   • shipping options — kind 30406
//
// These are PURE functions returning unsigned event templates — signing +
// publishing happen via nostrAuth (extension or nsec). Editing reuses the same
// `d` tag (replaceable), and unmanaged tags are carried over so custom data
// isn't dropped. Kept free of DOM/relay code so it can be unit-reasoned about.

import { kebab, tagVal, tagsAll, MARKET_TAG, type NostrEvent } from './market';

export const PRODUCT_KIND = 30402;
export const COLLECTION_KIND = 30405;
export const SHIPPING_KIND = 30406;

// Unique, stable addressable id: <prefix><kebab-title>-<random>. Reused on edit.
function genId(prefix: string, title: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${kebab(title) || 'item'}-${rand}`;
}

type Unsigned = { kind: number; created_at: number; content: string; tags: string[][] };
const now = () => Math.floor(Date.now() / 1000);

// Carry over tags the form doesn't manage, so custom/extra data survives an edit.
function keepUnmanaged(existing: NostrEvent | undefined, managed: Set<string>): string[][] {
  if (!existing) return [];
  return existing.tags.filter((t) => !managed.has(t[0]));
}

// ---------- Products (30402) ----------
export interface ProductForm {
  id: string;
  title: string;
  summary: string;
  description: string;
  priceAmount: string;
  priceCurrency: string;
  images: string[];
  visibility: string; // on-sale | pre-order | hidden
  stock: string; // '' = unlimited
  location: string;
  categories: string[]; // free-text `t` tags (excludes the market marker)
  listed: boolean; // carries the `t`=lightningpiggy marker → shows in the LP market
}
const PRODUCT_MANAGED = new Set([
  'd',
  'title',
  'summary',
  'price',
  'image',
  'visibility',
  'stock',
  'location',
  't',
  'published_at',
  'client',
]);

export function buildProduct(form: ProductForm, existing?: NostrEvent): Unsigned {
  const d = (existing && tagVal(existing.tags, 'd')) || form.id || genId('', form.title);
  const publishedAt = (existing && tagVal(existing.tags, 'published_at')) || String(now());
  const tags: string[][] = [
    ['d', d],
    ['title', form.title.trim()],
    ...(form.summary.trim() ? [['summary', form.summary.trim()]] : []),
    ['price', String(form.priceAmount).trim(), (form.priceCurrency || 'SATS').toUpperCase()],
    ...form.images.filter(Boolean).map((u, i) => ['image', u.trim(), '', String(i)]),
    ['visibility', form.visibility || 'on-sale'],
    ...(form.stock.trim() ? [['stock', form.stock.trim()]] : []),
    ...(form.location.trim() ? [['location', form.location.trim()]] : []),
    // Market marker + free-text categories (marker de-duped from user categories).
    ...(form.listed ? [['t', MARKET_TAG]] : []),
    ...form.categories
      .map((c) => c.trim())
      .filter((c) => c && c.toLowerCase() !== MARKET_TAG)
      .map((c) => ['t', c]),
    ['published_at', publishedAt],
    ...keepUnmanaged(existing, PRODUCT_MANAGED),
  ];
  return { kind: PRODUCT_KIND, created_at: now(), content: form.description || '', tags };
}

export function parseProductForm(ev: NostrEvent): ProductForm {
  const price = ev.tags.find((t) => t[0] === 'price');
  return {
    id: tagVal(ev.tags, 'd') || '',
    title: tagVal(ev.tags, 'title') || '',
    summary: tagVal(ev.tags, 'summary') || '',
    description: ev.content || '',
    priceAmount: price?.[1] || '',
    priceCurrency: (price?.[2] || 'SATS').toUpperCase(),
    images: ev.tags.filter((t) => t[0] === 'image' && t[1]).map((t) => t[1]),
    visibility: tagVal(ev.tags, 'visibility') || 'on-sale',
    stock: tagVal(ev.tags, 'stock') || '',
    location: tagVal(ev.tags, 'location') || '',
    categories: tagsAll(ev.tags, 't').filter((c) => (c || '').toLowerCase() !== MARKET_TAG),
    listed: tagsAll(ev.tags, 't').some((c) => (c || '').toLowerCase() === MARKET_TAG),
  };
}

// Whether a product will appear on the Lightning Piggy market, and why not.
export function productDisplayStatus(f: ProductForm): { shown: boolean; label: string; hint: string } {
  if (f.visibility === 'hidden')
    return { shown: false, label: 'Hidden', hint: 'Set visibility to “on-sale” to show it.' };
  if (!f.listed)
    return {
      shown: false,
      label: 'Not listed',
      hint: 'Turn on “List in the Lightning Piggy market”.',
    };
  return { shown: true, label: 'Shown', hint: '' };
}

export function validateProduct(f: ProductForm): string[] {
  const e: string[] = [];
  if (!f.title.trim()) e.push('Title is required.');
  const amt = parseFloat(f.priceAmount);
  if (!isFinite(amt) || amt < 0) e.push('Price must be a non-negative number.');
  if (!f.priceCurrency.trim()) e.push('Currency is required.');
  for (const u of f.images.filter(Boolean)) {
    if (!/^https?:\/\//.test(u)) e.push(`Image URL must start with http(s): ${u}`);
  }
  if (f.stock.trim() && !/^\d+$/.test(f.stock.trim())) e.push('Stock must be a whole number.');
  return e;
}

// ---------- Categories / collections (30405) ----------
export interface CollectionForm {
  id: string;
  title: string;
  description: string;
  image: string;
  productIds: string[]; // product d-tags to include
}
const COLLECTION_MANAGED = new Set(['d', 'title', 'image', 'a']);

export function buildCollection(
  form: CollectionForm,
  vendorHex: string,
  existing?: NostrEvent,
): Unsigned {
  const d = (existing && tagVal(existing.tags, 'd')) || form.id || genId('collection-', form.title);
  const tags: string[][] = [
    ['d', d],
    ['title', form.title.trim()],
    ...(form.image.trim() ? [['image', form.image.trim()]] : []),
    ...form.productIds.filter(Boolean).map((pid) => ['a', `${PRODUCT_KIND}:${vendorHex}:${pid}`]),
    ...keepUnmanaged(existing, COLLECTION_MANAGED),
  ];
  return { kind: COLLECTION_KIND, created_at: now(), content: form.description || '', tags };
}

export function parseCollectionForm(ev: NostrEvent): CollectionForm {
  return {
    id: tagVal(ev.tags, 'd') || '',
    title: tagVal(ev.tags, 'title') || '',
    description: ev.content || '',
    image: tagVal(ev.tags, 'image') || '',
    productIds: ev.tags
      .filter((t) => t[0] === 'a' && t[1])
      .map((t) => t[1].split(':')[2])
      .filter(Boolean),
  };
}

export function validateCollection(f: CollectionForm): string[] {
  return f.title.trim() ? [] : ['Title is required.'];
}

// ---------- Shipping options (30406) ----------
export interface ShippingForm {
  id: string;
  title: string;
  priceAmount: string;
  priceCurrency: string;
  countries: string[]; // ISO 3166-1 alpha-2
  service: string; // standard | express | overnight | pickup
  carrier: string;
}
const SHIPPING_MANAGED = new Set(['d', 'title', 'price', 'country', 'service', 'carrier']);

export function buildShipping(form: ShippingForm, existing?: NostrEvent): Unsigned {
  const d = (existing && tagVal(existing.tags, 'd')) || form.id || genId('ship-', form.title);
  const countries = form.countries.map((c) => c.trim().toUpperCase()).filter(Boolean);
  const tags: string[][] = [
    ['d', d],
    ['title', form.title.trim()],
    ['price', String(form.priceAmount).trim(), (form.priceCurrency || 'SATS').toUpperCase()],
    ...(countries.length ? [['country', ...countries]] : []),
    ['service', form.service || 'standard'],
    ...(form.carrier.trim() ? [['carrier', form.carrier.trim()]] : []),
    ...keepUnmanaged(existing, SHIPPING_MANAGED),
  ];
  return { kind: SHIPPING_KIND, created_at: now(), content: '', tags };
}

export function parseShippingForm(ev: NostrEvent): ShippingForm {
  const price = ev.tags.find((t) => t[0] === 'price');
  const countryTag = ev.tags.find((t) => t[0] === 'country');
  return {
    id: tagVal(ev.tags, 'd') || '',
    title: tagVal(ev.tags, 'title') || '',
    priceAmount: price?.[1] || '',
    priceCurrency: (price?.[2] || 'SATS').toUpperCase(),
    countries: countryTag ? countryTag.slice(1).filter(Boolean) : [],
    service: tagVal(ev.tags, 'service') || 'standard',
    carrier: tagVal(ev.tags, 'carrier') || '',
  };
}

export function validateShipping(f: ShippingForm): string[] {
  const e: string[] = [];
  if (!f.title.trim()) e.push('Title is required.');
  const amt = parseFloat(f.priceAmount);
  if (!isFinite(amt) || amt < 0) e.push('Price must be a non-negative number.');
  if (!f.priceCurrency.trim()) e.push('Currency is required.');
  if (!f.countries.map((c) => c.trim()).filter(Boolean).length)
    e.push('At least one destination country is required.');
  return e;
}

// ---------- NIP-09 deletion (kind 5) ----------
export function buildDelete(kind: number, vendorHex: string, dtag: string): Unsigned {
  return {
    kind: 5,
    created_at: now(),
    content: 'deleted',
    tags: [
      ['a', `${kind}:${vendorHex}:${dtag}`],
      ['k', String(kind)],
    ],
  };
}
