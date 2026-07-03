// gammaShipping.ts
// PURE shipping logic for Gamma Markets checkouts — no DOM, no relay IO, no UI
// dependency, so the SAME module can be used verbatim in lightning-piggy-website
// (Astro), robotechy-website (React) and Lightning Piggy Mobile (React Native).
// The host app supplies events (from its own relay layer) and a sats converter.
//
// Spec refs (github.com/GammaMarkets/market-spec):
//   • product `shipping_option` tags: ["shipping_option", "<30406|30405>:<pk>:<d>", "<extra-cost>"]
//     — extra-cost is in the PRODUCT's currency; 30405 refs inherit the
//     collection's options (direct + inherited MUST be merged).
//   • 30406 `country` tag lists where an option is available; clients must
//     validate constraints before offering options.

export interface GammaEvent {
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface ShippingRef {
  coord: string; // "30406:<pk>:<d>" or "30405:<pk>:<d>"
  extraCost: number; // in the product's currency
}

export interface ShippingOption {
  coord: string; // "30406:<pk>:<d>"
  title: string;
  amount: number; // base cost
  currency: string; // base-cost currency (upper-case)
  countries: string[]; // ISO 3166-1 alpha-2, upper-case; [] = worldwide
  service: string;
  extraCost: number; // per-product surcharge, in the PRODUCT's currency
}

const tagVal = (tags: string[][], k: string) => tags.find((t) => t[0] === k)?.[1];

// Parse a product's `shipping_option` tags.
export function parseShippingRefs(productTags: string[][]): ShippingRef[] {
  return productTags
    .filter((t) => t[0] === 'shipping_option' && /^(30406|30405):[0-9a-f]{64}:/.test(t[1] || ''))
    .map((t) => ({ coord: t[1], extraCost: parseFloat(t[2] || '0') || 0 }));
}

// Parse a kind-30406 event into a ShippingOption (null if malformed).
export function parseShippingOption(ev: GammaEvent, extraCost = 0): ShippingOption | null {
  if (ev.kind !== 30406) return null;
  const price = ev.tags.find((t) => t[0] === 'price');
  const countryTag = ev.tags.find((t) => t[0] === 'country');
  const o: ShippingOption = {
    coord: `30406:${ev.pubkey}:${tagVal(ev.tags, 'd') || ''}`,
    title: tagVal(ev.tags, 'title') || '',
    amount: parseFloat(price?.[1] || ''),
    currency: (price?.[2] || 'SATS').toUpperCase(),
    countries: countryTag ? countryTag.slice(1).filter(Boolean).map((c) => c.toUpperCase()) : [],
    service: tagVal(ev.tags, 'service') || 'standard',
    extraCost,
  };
  return o.title && isFinite(o.amount) && o.amount >= 0 ? o : null;
}

// Resolve a product's declared refs against a pool of fetched events (30406
// options + 30405 collections, newest-per-coordinate, deletions already
// applied by the host). Direct refs and collection-inherited refs are merged
// (spec MUST); a direct ref's extra-cost wins over a collection's for the same
// option. Returns the option coords still missing from `events` so the host
// can fetch them and call again.
export function resolveShippingRefs(
  refs: ShippingRef[],
  events: GammaEvent[],
): { options: ShippingOption[]; missingCoords: string[] } {
  const byCoord = new Map(events.map((ev) => [`${ev.kind}:${ev.pubkey}:${tagVal(ev.tags, 'd') || ''}`, ev]));
  const wanted = new Map<string, number>(); // 30406 coord -> extra
  for (const r of refs) if (r.coord.startsWith('30406:')) wanted.set(r.coord, r.extraCost);
  for (const r of refs) {
    if (!r.coord.startsWith('30405:')) continue;
    const col = byCoord.get(r.coord);
    if (!col) continue;
    for (const t of col.tags) {
      if (t[0] === 'shipping_option' && /^30406:[0-9a-f]{64}:/.test(t[1] || '') && !wanted.has(t[1]))
        wanted.set(t[1], r.extraCost);
    }
  }
  const options: ShippingOption[] = [];
  const missingCoords: string[] = [];
  for (const [coord, extra] of wanted) {
    const ev = byCoord.get(coord);
    if (!ev) missingCoords.push(coord);
    else {
      const o = parseShippingOption(ev, extra);
      if (o) options.push(o);
    }
  }
  return { options, missingCoords };
}

// Options available for a destination country ('' = no country chosen yet →
// everything). An option with no country list counts as worldwide.
export function filterShippingOptions(options: ShippingOption[], countryCode: string): ShippingOption[] {
  const cc = (countryCode || '').toUpperCase();
  return options.filter((o) => !o.countries.length || !cc || o.countries.includes(cc));
}

// The two cost parts of a chosen option: the base (option currency) and the
// per-product extra (product currency). Kept separate because they may be in
// different currencies; the host converts each with its own rate source.
export function shippingCostParts(
  option: ShippingOption,
  productCurrency: string,
): { amount: number; currency: string }[] {
  const parts = [{ amount: option.amount, currency: option.currency }];
  if (option.extraCost) parts.push({ amount: option.extraCost, currency: (productCurrency || 'SATS').toUpperCase() });
  return parts;
}

// All-in order total in sats (Gamma: order `amount` = the full total).
// `toSats` is host-supplied (rate source differs per platform).
export async function orderTotalSats(
  items: { amount: number; currency: string; quantity?: number }[],
  shippingOption: ShippingOption | null,
  productCurrency: string,
  toSats: (amount: number, currency: string) => Promise<number | null>,
): Promise<{ productSats: number; shippingSats: number; totalSats: number } | null> {
  let productSats = 0;
  for (const it of items) {
    const s = await toSats(it.amount * (it.quantity ?? 1), it.currency);
    if (s === null) return null;
    productSats += s;
  }
  let shippingSats = 0;
  if (shippingOption) {
    for (const part of shippingCostParts(shippingOption, productCurrency)) {
      const s = await toSats(part.amount, part.currency);
      if (s === null) return null;
      shippingSats += s;
    }
  }
  return { productSats, shippingSats, totalSats: productSats + shippingSats };
}

// Best-guess destination country from a BCP-47 locale ("en-GB" → "GB").
export function countryFromLocale(locale: string): string {
  try {
    const region = (new Intl.Locale(locale).maximize?.() || new Intl.Locale(locale)).region;
    return region && /^[A-Z]{2}$/.test(region) ? region : '';
  } catch {
    const m = (locale || '').match(/[-_]([A-Za-z]{2})\b/);
    return m ? m[1].toUpperCase() : '';
  }
}
