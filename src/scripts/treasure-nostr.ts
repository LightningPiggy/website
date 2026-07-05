// ---------------------------------------------------------------------------
// Shared Treasure Hunt logic (Nostr NIP-GC caches + find log + card chrome).
//
// This module is the single source of truth shared by:
//   - the interactive world map  (src/pages/treasure-hunt.astro)
//   - the full treasure detail page (src/pages/treasure.astro)
// so the two never drift apart. It is a browser-only module (it touches
// `document`, `WebSocket`, `TextEncoder`, …) - both callers run it from a
// bundled Astro <script>, never at build time.
// ---------------------------------------------------------------------------

import qrcode from 'qrcode-generator';

// An inline SVG QR code for `text` (e.g. a bolt11 invoice), rendered without any
// external request. Low error-correction to fit long invoices; auto version.
function qrSvg(text: string): string {
  const qr = qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
}

// -----------------------------------------------------------------------
// Pure helpers (ported verbatim from the Lightning Piggy mobile app)
// -----------------------------------------------------------------------
// rot13 - faithful port of the mobile app's rot13 obfuscation/decode (the
// two are the same operation). Hints are rot13-obfuscated on the wire.
export function rot13Decode(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      out += String.fromCharCode(((code - 65 + 13) % 26) + 65);
    } else if (code >= 97 && code <= 122) {
      out += String.fromCharCode(((code - 97 + 13) % 26) + 97);
    } else {
      out += input[i];
    }
  }
  return out;
}

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function decodeGeohash(gh: string): { lat: number; lng: number } {
  let latLo = -90,
    latHi = 90,
    lonLo = -180,
    lonHi = 180,
    evenBit = true;
  for (let i = 0; i < gh.length; i++) {
    const idx = GEOHASH_BASE32.indexOf(gh[i].toLowerCase());
    if (idx < 0) continue;
    for (let bit = 4; bit >= 0; bit--) {
      const set = (idx >> bit) & 1;
      if (evenBit) {
        const mid = (lonLo + lonHi) / 2;
        if (set) lonLo = mid;
        else lonHi = mid;
      } else {
        const mid = (latLo + latHi) / 2;
        if (set) latLo = mid;
        else latHi = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { lat: (latLo + latHi) / 2, lng: (lonLo + lonHi) / 2 };
}

// -----------------------------------------------------------------------
// Sanitisation helpers (mirrors NostrProducts.astro)
// -----------------------------------------------------------------------
export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return url;
  } catch {}
  return '';
}

// -----------------------------------------------------------------------
// Nostr relays + types
// -----------------------------------------------------------------------
export const GC_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.ditto.pub',
  'wss://relay.dreamith.to',
];

// The visitor's own relays, read from their NIP-07 signer (Alby, nos2x, …) via
// the optional getRelays() method and merged with GC_RELAYS - so we also read
// from, and publish to, the relays they actually use. Best-effort and silent:
// signers that don't expose getRelays just fall back to GC_RELAYS, and we never
// prompt. Cached for the page; resetUserRelays() re-reads (e.g. after signing).
let userRelays: { read: string[]; write: string[] } | undefined;

async function ensureUserRelays(): Promise<{ read: string[]; write: string[] }> {
  if (userRelays !== undefined) return userRelays;
  const result = { read: [] as string[], write: [] as string[] };
  const nostr = (window as any).nostr;
  try {
    if (nostr && typeof nostr.getRelays === 'function') {
      const map = (await nostr.getRelays()) as Record<string, { read?: boolean; write?: boolean }>;
      for (const [url, policy] of Object.entries(map || {})) {
        if (!/^wss?:\/\//i.test(url)) continue;
        if (!policy || policy.read !== false) result.read.push(url);
        if (!policy || policy.write !== false) result.write.push(url);
      }
    }
  } catch {
    // getRelays unsupported or denied - stick with GC_RELAYS.
  }
  userRelays = result;
  return userRelays;
}

// Re-read the visitor's relays on the next read/write (e.g. once they connect a
// signer, so a subsequent share/find-log also reaches their write relays).
export function resetUserRelays(): void {
  userRelays = undefined;
}

// GC_RELAYS plus a few of the visitor's own relays (capped so we don't open too
// many sockets): `readRelays` for REQ subscriptions, `writeRelays` for EVENT.
async function readRelays(): Promise<string[]> {
  const u = await ensureUserRelays();
  return [...new Set([...GC_RELAYS, ...u.read.slice(0, 5)])];
}
async function writeRelays(): Promise<string[]> {
  const u = await ensureUserRelays();
  return [...new Set([...GC_RELAYS, ...u.write.slice(0, 5)])];
}

// The parameterised-replaceable kind that carries NIP-GC caches (and their
// found-logs). A cache's Nostr "coordinate" (a-tag address) is therefore
// `37516:<hiderPubkey>:<d>`.
export const GC_CACHE_KIND = 37516;

export interface NostrEvent {
  id: string;
  content: string;
  tags: string[][];
  pubkey: string;
  kind: number;
  created_at: number;
}

export interface ParsedCache {
  d: string;
  name: string;
  description: string;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  cacheType: string | null;
  geohash: string;
  hint: string | null;
  imageUrl: string | null;
  payoutSats: number | null;
  waitSeconds: number | null;
  uses: number | null;
  expiresAt: number | null;
  createdAt: number;
  hiderPubkey: string;
  coord: string;
  isLpPiggy: boolean;
  lat: number;
  lng: number;
}

// First tag value for a key.
export function firstTag(tags: string[][], key: string): string | undefined {
  const t = tags.find((tag) => tag[0] === key);
  return t ? t[1] : undefined;
}

export function intOrNull(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export function parseCache(event: NostrEvent): ParsedCache | null {
  const tags = event.tags || [];
  const d = firstTag(tags, 'd');
  if (!d) return null;

  // Longest g tag → geohash. No g tag → no location → skip.
  const gTags = tags
    .filter((t) => t[0] === 'g' && typeof t[1] === 'string')
    .map((t) => t[1])
    .sort((a, b) => b.length - a.length);
  const geohash = gTags[0];
  if (!geohash) return null;

  const { lat, lng } = decodeGeohash(geohash);

  const hintRaw = firstTag(tags, 'hint');
  const imageUrlRaw = firstTag(tags, 'image');

  const isLpPiggy = tags.some(
    (t) => t[0] === 'l' && t[1] === 'payout-lnurl-w' && t[2] === 'com.lightningpiggy.app',
  );

  return {
    d,
    name: firstTag(tags, 'name') || 'Unnamed cache',
    description: event.content || '',
    difficulty: intOrNull(firstTag(tags, 'D')),
    terrain: intOrNull(firstTag(tags, 'T')),
    size: firstTag(tags, 'S') || null,
    cacheType: firstTag(tags, 't') || null,
    geohash,
    hint: hintRaw ? rot13Decode(hintRaw) : null,
    imageUrl: imageUrlRaw || null,
    payoutSats: intOrNull(firstTag(tags, 'amount')),
    waitSeconds: intOrNull(firstTag(tags, 'wait')),
    uses: intOrNull(firstTag(tags, 'uses')),
    expiresAt: intOrNull(firstTag(tags, 'expiration')),
    createdAt: event.created_at,
    hiderPubkey: event.pubkey,
    coord: `${GC_CACHE_KIND}:${event.pubkey}:${d}`,
    isLpPiggy,
    lat,
    lng,
  };
}

// -----------------------------------------------------------------------
// Relay fetching (mirrors NostrProducts.astro WebSocket pattern)
// -----------------------------------------------------------------------
// Open one short-lived REQ against a single relay and resolve with every
// EVENT received for the given filter set (until EOSE or a timeout). The
// filters are spread into the REQ, so a caller can pass several filters in
// one subscription (e.g. found-logs AND comments) and the relay returns
// events matching any of them.
function reqFromRelay(
  relayUrl: string,
  filters: Record<string, unknown>[],
  timeoutMs = 6000,
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let ws: WebSocket;
    let timeout: number;

    try {
      ws = new WebSocket(relayUrl);
    } catch {
      resolve([]);
      return;
    }

    const subId = Math.random().toString(36).slice(2, 10);

    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, ...filters]));
      timeout = window.setTimeout(() => {
        try {
          ws.close();
        } catch {}
        resolve(events);
      }, timeoutMs);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
          events.push(msg[2]);
        }
        if (msg[0] === 'EOSE' && msg[1] === subId) {
          clearTimeout(timeout);
          try {
            ws.close();
          } catch {}
          resolve(events);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve([]);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}

// Fan the same filter set across every relay (GC_RELAYS + the visitor's own),
// then dedupe by event id (the same event echoes back from multiple relays).
export async function fetchEvents(filters: Record<string, unknown>[]): Promise<NostrEvent[]> {
  const relays = await readRelays();
  const results = await Promise.all(relays.map((r) => reqFromRelay(r, filters)));
  const byId = new Map<string, NostrEvent>();
  for (const ev of results.flat()) {
    if (ev?.id && !byId.has(ev.id)) byId.set(ev.id, ev);
  }
  return [...byId.values()];
}

export async function fetchCaches(): Promise<ParsedCache[]> {
  const allEvents = (await fetchEvents([{ kinds: [GC_CACHE_KIND], limit: 500 }])).filter(
    (ev) => ev.kind === GC_CACHE_KIND,
  );

  const now = Math.floor(Date.now() / 1000);

  // Dedupe parameterised-replaceable events: key by pubkey:d, keep newest.
  const newest = new Map<string, NostrEvent>();
  for (const ev of allEvents) {
    const d = firstTag(ev.tags || [], 'd');
    if (!d) continue;
    const key = ev.pubkey + ':' + d;
    const existing = newest.get(key);
    if (!existing || ev.created_at > existing.created_at) {
      newest.set(key, ev);
    }
  }

  const caches: ParsedCache[] = [];
  for (const ev of newest.values()) {
    const cache = parseCache(ev);
    if (!cache) continue;
    if (cache.expiresAt != null && cache.expiresAt < now) continue; // expired
    caches.push(cache);
  }
  return caches;
}

// Fetch a single cache by its NIP-GC coordinate parts (kind/author/d), keeping
// the newest matching parameterised-replaceable event. Used by the detail page,
// which resolves one cache from the naddr in its URL rather than the whole map.
export async function fetchCache(
  kind: number,
  pubkey: string,
  d: string,
): Promise<ParsedCache | null> {
  const events = (
    await fetchEvents([{ kinds: [kind], authors: [pubkey], '#d': [d], limit: 10 }])
  ).filter((ev) => ev.kind === kind && ev.pubkey === pubkey);

  let newest: NostrEvent | null = null;
  for (const ev of events) {
    if (firstTag(ev.tags || [], 'd') !== d) continue;
    if (!newest || ev.created_at > newest.created_at) newest = ev;
  }
  return newest ? parseCache(newest) : null;
}

// -----------------------------------------------------------------------
// Find log (mirrors the mobile app's HuntPiggyDetailScreen)
// -----------------------------------------------------------------------
// A cache's "find log" is the stream of finders' notes attached to it on
// Nostr. Two event kinds make it up (matching the mobile app):
//   - kind 7516 NIP-GC found-logs, pointing at the cache via a lowercase
//     `a` tag, optionally carrying an `image` and a self-reported `amount`.
//   - kind 1111 NIP-22 comments, pointing at the cache via an uppercase
//     `A` root tag.
const GC_FOUND_LOG_KIND = 7516;
const GC_COMMENT_KIND = 1111;

export interface FindLogEntry {
  id: string;
  pubkey: string;
  createdAt: number;
  content: string;
  imageUrl: string | null;
  amountSats: number | null;
  isComment: boolean;
}

function parseFindLog(ev: NostrEvent): FindLogEntry {
  const amt = intOrNull(firstTag(ev.tags || [], 'amount'));
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    createdAt: ev.created_at,
    content: ev.content || '',
    imageUrl: firstTag(ev.tags || [], 'image') || null,
    amountSats: amt != null && amt > 0 ? amt : null,
    isComment: ev.kind === GC_COMMENT_KIND,
  };
}

// A finder's resolved Nostr profile (kind-0 metadata): the bits we render, plus
// the Lightning address (lud16) / LNURL (lud06) used to zap them.
export interface FinderProfile {
  name: string | null;
  picture: string | null;
  lud16: string | null;
  lud06: string | null;
}

// Profiles are shared across caches and rarely change, so cache them for
// the life of the page - reopening popups or revisiting a finder is then
// instant and never re-hits the relays.
const profileCache = new Map<string, FinderProfile>();

async function fetchProfiles(pubkeys: string[]): Promise<void> {
  const missing = pubkeys.filter((p) => !profileCache.has(p));
  if (missing.length === 0) return;

  const events = await fetchEvents([{ kinds: [0], authors: missing }]);

  // Keep the newest kind-0 per author (profile metadata is replaceable).
  const newest = new Map<string, NostrEvent>();
  for (const ev of events) {
    if (ev.kind !== 0) continue;
    const existing = newest.get(ev.pubkey);
    if (!existing || ev.created_at > existing.created_at) newest.set(ev.pubkey, ev);
  }

  const empty: FinderProfile = { name: null, picture: null, lud16: null, lud06: null };
  for (const pk of missing) {
    const ev = newest.get(pk);
    if (!ev) {
      profileCache.set(pk, { ...empty });
      continue;
    }
    try {
      const meta = JSON.parse(ev.content || '{}');
      const picture = typeof meta.picture === 'string' ? sanitizeUrl(meta.picture) : '';
      profileCache.set(pk, {
        name: meta.display_name || meta.displayName || meta.name || null,
        picture: picture || null,
        lud16: typeof meta.lud16 === 'string' && meta.lud16.includes('@') ? meta.lud16 : null,
        lud06: typeof meta.lud06 === 'string' && meta.lud06 ? meta.lud06 : null,
      });
    } catch {
      profileCache.set(pk, { ...empty });
    }
  }
}

// Lucide `user` - the avatar fallback when a finder has no picture (mirrors
// the app's LogRow fallback).
const USER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${'#EC008C'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

// -----------------------------------------------------------------------
// bech32 + NIP-19 (npub / naddr) codec
// -----------------------------------------------------------------------
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32Checksum(hrp: string, data: number[]): number[] {
  const polymod = bech32Polymod(bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0])) ^ 1;
  const ret: number[] = [];
  for (let i = 0; i < 6; i++) ret.push((polymod >> (5 * (5 - i))) & 31);
  return ret;
}

// Regroup between 8-bit bytes and 5-bit bech32 groups (with optional padding).
function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv)) {
    return null;
  }
  return ret;
}

function bech32Encode(hrp: string, bytes: number[]): string {
  const data = convertBits(bytes, 8, 5, true);
  if (!data) return '';
  const combined = data.concat(bech32Checksum(hrp, data));
  return hrp + '1' + combined.map((d) => BECH32_CHARSET[d]).join('');
}

function bech32Decode(str: string): { hrp: string; data: number[] } | null {
  const lower = str.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  const data: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx < 0) return null;
    data.push(idx);
  }
  if (bech32Polymod(bech32HrpExpand(hrp).concat(data)) !== 1) return null;
  return { hrp, data: data.slice(0, -6) };
}

function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function npubEncode(hex: string): string {
  return bech32Encode('npub', hexToBytes(hex));
}

export interface NaddrData {
  kind: number;
  pubkey: string;
  identifier: string;
  relays: string[];
}

// Encode a parameterised-replaceable event coordinate as a NIP-19 `naddr`
// (bech32 TLV: 0=identifier, 1=relay, 2=author, 3=kind). Used to build the
// shareable /treasure/<naddr> URL for a cache.
export function naddrEncode(a: NaddrData): string {
  const tlv: number[] = [];
  const pushTlv = (type: number, value: number[]) => {
    tlv.push(type, value.length, ...value);
  };
  pushTlv(0, Array.from(new TextEncoder().encode(a.identifier)));
  for (const r of a.relays || []) pushTlv(1, Array.from(new TextEncoder().encode(r)));
  pushTlv(2, hexToBytes(a.pubkey));
  pushTlv(3, [(a.kind >>> 24) & 0xff, (a.kind >>> 16) & 0xff, (a.kind >>> 8) & 0xff, a.kind & 0xff]);
  return bech32Encode('naddr', tlv);
}

// Decode a NIP-19 `naddr` back into its coordinate parts, or null if it isn't
// a well-formed naddr. Missing/short TLV entries are tolerated - only author
// and kind are required for a usable coordinate.
export function naddrDecode(naddr: string): NaddrData | null {
  const dec = bech32Decode(naddr.trim());
  if (!dec || dec.hrp !== 'naddr') return null;
  const bytes = convertBits(dec.data, 5, 8, false);
  if (!bytes) return null;

  let i = 0;
  let identifier = '';
  let pubkey = '';
  let kind = -1;
  const relays: string[] = [];
  const decoder = new TextDecoder();
  while (i + 2 <= bytes.length) {
    const type = bytes[i++];
    const len = bytes[i++];
    if (i + len > bytes.length) break;
    const value = bytes.slice(i, i + len);
    i += len;
    if (type === 0) identifier = decoder.decode(new Uint8Array(value));
    else if (type === 1) relays.push(decoder.decode(new Uint8Array(value)));
    else if (type === 2) pubkey = bytesToHex(value);
    else if (type === 3 && len === 4)
      kind = ((value[0] << 24) | (value[1] << 16) | (value[2] << 8) | value[3]) >>> 0;
  }
  if (!/^[0-9a-f]{64}$/.test(pubkey) || kind < 0) return null;
  return { kind, pubkey, identifier, relays };
}

// A profile-less pubkey as a short npub (`npub1abcde…xyz123`), falling back
// to a hex shorty if encoding fails - mirrors the app's shortNpub util.
export function shortNpub(pk: string): string {
  if (/^[0-9a-f]{64}$/i.test(pk)) {
    try {
      const npub = npubEncode(pk.toLowerCase());
      if (npub) return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
    } catch {
      /* fall through to hex */
    }
  }
  return pk.length > 12 ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : pk;
}

// The naddr coordinate for a parsed cache. Bare by default (short /treasure/<naddr>
// deep links, which our own page resolves via GC_RELAYS anyway); pass `relays`
// to embed relay hints so *other* Nostr clients (njump, Primal, …) can resolve
// a shared link even if they don't already index these relays.
export function cacheNaddr(cache: ParsedCache, relays: string[] = []): string {
  return naddrEncode({
    kind: GC_CACHE_KIND,
    pubkey: cache.hiderPubkey,
    identifier: cache.d,
    relays,
  });
}

function relativeTime(ts: number): string {
  const mins = Math.floor(Date.now() / 1000 - ts) / 60;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// A circular avatar: the finder's picture on top of a pink fallback ring
// holding the `user` glyph. If the image 404s it removes itself, revealing
// the fallback underneath - no broken-image icon.
export function avatarHtml(picture: string | null): string {
  const img = picture
    ? `<img src="${picture}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">`
    : '';
  return `<span style="position:relative;width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:9999px;background:#fce7f3;overflow:hidden;">${USER_SVG}${img}</span>`;
}

function renderLogRow(log: FindLogEntry): string {
  const prof = profileCache.get(log.pubkey) || { name: null, picture: null };
  const display = prof.name ? escapeHtml(prof.name) : escapeHtml(shortNpub(log.pubkey));
  const age = relativeTime(log.createdAt);

  const safeImg = log.imageUrl ? sanitizeUrl(log.imageUrl) : '';
  const imgBlock = safeImg
    ? `<img src="${safeImg}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" style="margin-top:6px;width:100%;border-radius:8px;object-fit:cover;max-height:130px;">`
    : '';

  const satsBadge =
    log.amountSats != null
      ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-top:5px;font-size:11px;font-weight:600;color:${BRAND_PINK};">${ZAP_SVG} Reported ${log.amountSats.toLocaleString()} sats</span>`
      : '';

  const content = log.content
    ? `<p style="margin-top:3px;font-size:12px;color:#374151;line-height:1.4;white-space:pre-wrap;word-break:break-word;">${escapeHtml(
        log.content,
      )}</p>`
    : '';

  return `
    <div style="display:flex;gap:8px;padding:8px 0;border-top:1px solid #f3f4f6;">
      ${avatarHtml(prof.picture)}
      <div style="min-width:0;flex:1;">
        <div style="display:flex;align-items:baseline;gap:6px;">
          <span style="font-size:12px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${display}</span>
          <span style="font-size:11px;color:#9ca3af;flex:none;">${age}</span>
        </div>
        ${content}
        ${imgBlock}
        ${satsBadge}
      </div>
    </div>
  `;
}

// Load and render a cache's find log into an already-mounted container. Guards
// on `isConnected` so a detached container (e.g. a closed popup, or one
// reopened on another cache) is never written to.
export async function loadFindLog(coord: string, bodyEl: HTMLElement): Promise<void> {
  let logs: FindLogEntry[];
  try {
    const events = await fetchEvents([
      { kinds: [GC_FOUND_LOG_KIND], '#a': [coord], limit: 100 },
      { kinds: [GC_COMMENT_KIND], '#A': [coord], limit: 100 },
    ]);
    logs = events
      .filter((ev) => ev.kind === GC_FOUND_LOG_KIND || ev.kind === GC_COMMENT_KIND)
      .map(parseFindLog)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    if (bodyEl.isConnected) bodyEl.textContent = 'Could not load finds.';
    return;
  }

  if (!bodyEl.isConnected) return;
  if (logs.length === 0) {
    bodyEl.textContent = 'No finds logged yet - be the first!';
    return;
  }

  await fetchProfiles([...new Set(logs.map((l) => l.pubkey))]);
  if (!bodyEl.isConnected) return;

  const count = logs.length;
  bodyEl.innerHTML =
    `<div style="font-size:11px;color:#9ca3af;margin-bottom:2px;">${count} find${
      count === 1 ? '' : 's'
    }</div>` + logs.map(renderLogRow).join('');
}

// Resolve the hider's profile and fill in the "Hidden by …" row. The row starts
// as a skeleton (see hiderRowHtml); once the kind-0 lookup settles we show the
// profile name, or fall back to a short npub only then - so no placeholder ever
// flashes and flips to the real name mid-load.
async function loadHider(
  pubkey: string,
  nameEl: HTMLElement | null,
  avatarEl: HTMLElement | null,
): Promise<void> {
  await fetchProfiles([pubkey]);
  const prof = profileCache.get(pubkey);
  if (nameEl?.isConnected) {
    const display = prof?.name || shortNpub(pubkey);
    nameEl.textContent = `Hidden by ${display}`;
    nameEl.style.color = '#111827';
  }
  if (prof?.picture && avatarEl?.isConnected) avatarEl.innerHTML = avatarHtml(prof.picture);
}

// -----------------------------------------------------------------------
// Marker + card chrome (mirrors CacheDetailSheet)
// -----------------------------------------------------------------------
export const BRAND_PINK = '#EC008C';
// The app's `cachePurple` (src/styles/palettes.ts) - vanilla NIP-GC caches.
export const CACHE_PURPLE = '#7A5CFF';

// Lucide `piggy-bank` (Piglets) and `map-pin` (vanilla NIP-GC caches) - the
// same two glyphs the mobile app uses on its map (src/components/LibreMiniMap.tsx:
// Piglet → PiggyBank pink, NIP-GC → MapPin purple).
const PIGGY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/><path d="M16 11h.01"/></svg>`;
const MAPPIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`;
// Lucide `zap`, filled - the app's zapYellow prize badge (LpPayoutBadge.tsx).
const ZAP_YELLOW = '#FFC107';
const ZAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="${ZAP_YELLOW}" stroke="${ZAP_YELLOW}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>`;

// A Piglet carrying a withdrawable prize (LP label + advertised sats) gets the
// yellow ⚡ badge - same gate as the app's LpPayoutBadge (isLpPiggy && payoutSats != null).
export function hasPrize(cache: ParsedCache): boolean {
  return cache.isLpPiggy && cache.payoutSats != null;
}

export function zapBadgeHtml(): string {
  return `<span aria-label="Lightning payout available" style="position:absolute;top:-5px;right:-5px;width:18px;height:18px;border-radius:9999px;background:#fff;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${ZAP_SVG}</span>`;
}

// The circular badge used for a marker / card icon / legend swatch. Piglet =
// pink + piggy-bank glyph; NIP-GC = purple + map-pin glyph. White glyph + ring
// on both, mirroring the app's filled pins.
export function iconBadgeHtml(isLpPiggy: boolean, size = 32): string {
  const bg = isLpPiggy ? BRAND_PINK : CACHE_PURPLE;
  const glyph = isLpPiggy ? PIGGY_SVG : MAPPIN_SVG;
  return `<span style="display:inline-flex;width:${size}px;height:${size}px;align-items:center;justify-content:center;border-radius:9999px;background:${bg};border:2px solid #fff;color:#fff;flex:none;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${glyph}</span>`;
}

// A small lucide glyph, stroked in a caller-chosen colour.
function svgIcon(inner: string, color = '#6b7280', size = 13): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
const ICON_CLOCK = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
const ICON_REPEAT =
  '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>';
const ICON_BOX =
  '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>';
const ICON_CAMERA =
  '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>';
const ICON_PIN =
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>';
const ICON_PIGGY =
  '<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1"/><path d="M16 11h.01"/>';
// Lucide `copy`, `navigation`, `link` - Treasure Details + Share affordances.
const ICON_COPY =
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>';
const ICON_CHECK = '<path d="M20 6 9 17l-5-5"/>';
const ICON_NAV = '<polygon points="3 11 22 2 13 21 11 13 3 11"/>';
const ICON_SHARE =
  '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>';
const ICON_PENCIL =
  '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>';
// Lucide `eye` / `eye-off` - the app's hint reveal/hide toggle glyphs.
const ICON_EYE =
  '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>';
const ICON_EYE_OFF =
  '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>';

// A rounded spec pill: icon + label. Neutral white/grey by default; pass a
// background + text colour for the accent (kind) pill.
function pillHtml(
  label: string,
  iconSvg: string,
  opts: { bg?: string; color?: string; border?: boolean } = {},
): string {
  const bg = opts.bg ?? '#fff';
  const color = opts.color ?? '#374151';
  const border = opts.border === false ? 'none' : '1px solid #e5e7eb';
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:9999px;font-size:11px;font-weight:600;line-height:1.4;background:${bg};border:${border};color:${color};white-space:nowrap;">${iconSvg}${escapeHtml(
    label,
  )}</span>`;
}

// NIP-GC container sizes, ordered smallest→largest so the index gives the
// 1-5 meter value (mirrors the mobile app's SIZE_LABELS ordering).
const SIZE_RANK: Record<string, number> = {
  micro: 1,
  small: 2,
  regular: 3,
  large: 4,
  other: 5,
};

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The spec pills row (kind, prize, cooldown, claims, type, expiry). The old
// cryptic D1/T1/size bits move to the rating meters below (matching the app).
function pillsHtml(cache: ParsedCache): string {
  const pills: string[] = [];

  pills.push(
    cache.isLpPiggy
      ? pillHtml('Piglet', svgIcon(ICON_PIGGY, '#fff'), {
          bg: BRAND_PINK,
          color: '#fff',
          border: false,
        })
      : pillHtml('NIP-GC cache', svgIcon(ICON_PIN), { bg: '#f3f4f6', border: false }),
  );

  if (cache.payoutSats != null) {
    pills.push(pillHtml(`${cache.payoutSats.toLocaleString()} sats`, ZAP_SVG));
  }

  if (cache.waitSeconds != null) {
    const label =
      cache.waitSeconds >= 3600
        ? `${Math.round(cache.waitSeconds / 3600)}h cooldown`
        : `${Math.round(cache.waitSeconds / 60)}m cooldown`;
    pills.push(pillHtml(label, svgIcon(ICON_CLOCK)));
  }

  if (cache.uses != null) {
    pills.push(pillHtml(`${cache.uses.toLocaleString()} claims`, svgIcon(ICON_REPEAT)));
  }

  if (cache.cacheType) {
    pills.push(pillHtml(titleCase(cache.cacheType), svgIcon(ICON_BOX)));
  }

  if (cache.expiresAt != null) {
    const date = new Date(cache.expiresAt * 1000).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    pills.push(pillHtml(`Expires ${date}`, svgIcon(ICON_CLOCK)));
  }

  return pills.join('');
}

// A single labelled 1-5 rating meter (5 segments, filled pink up to value).
function meterHtml(label: string, value: number): string {
  const segs = [1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<span style="flex:1;height:6px;border-radius:2px;background:${
          i <= value ? BRAND_PINK : '#e5e7eb'
        };"></span>`,
    )
    .join('');
  return `<div style="flex:1;min-width:0;">
    <div style="font-size:10px;font-weight:700;color:#6b7280;margin-bottom:4px;">${label}</div>
    <div style="display:flex;gap:3px;">${segs}</div>
  </div>`;
}

// Difficulty / Terrain / Size meters (only the ones the cache actually set).
// Laid out in a row inside the popup card; the detail-page sidebar stacks them
// vertically (`vertical: true`) so each meter gets the full sidebar width.
function metersHtml(cache: ParsedCache, opts: { vertical?: boolean } = {}): string {
  const meters: string[] = [];
  if (cache.difficulty != null) meters.push(meterHtml('Difficulty', cache.difficulty));
  if (cache.terrain != null) meters.push(meterHtml('Terrain', cache.terrain));
  const sizeVal = cache.size ? SIZE_RANK[cache.size.toLowerCase()] : undefined;
  if (sizeVal != null) meters.push(meterHtml('Size', sizeVal));
  if (meters.length === 0) return '';
  const dir = opts.vertical ? 'column' : 'row';
  const mt = opts.vertical ? '0' : '12px';
  return `<div style="display:flex;flex-direction:${dir};gap:12px;margin-top:${mt};">${meters.join(
    '',
  )}</div>`;
}

// Web-mercator world-pixel position of a lng/lat at a given zoom.
function lngLatToWorldPx(lng: number, lat: number, z: number): { x: number; y: number } {
  const scale = 256 * Math.pow(2, z);
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// The tiles + centre pin of a static map thumbnail centred on the cache: a
// mosaic of CARTO raster tiles (the same basemap the live map uses) sized to
// fill a hero of `w`×`h` pixels, with a pin at its centre. No interactivity,
// no extra library - just <img> tiles. The tile range is derived from the hero
// size (not a fixed 3x3) so the mosaic always covers the whole hero - a wider
// hero, or a pin near a tile edge, no longer leaves an uncovered grey strip.
// The pixel size isn't known until the hero is laid out, so this is injected by
// `fillHeroMap` after render rather than baked into the markup.
function heroMapTiles(lat: number, lng: number, w: number, h: number): string {
  const z = 14;
  const n = Math.pow(2, z);
  const { x: px, y: py } = lngLatToWorldPx(lng, lat, z);
  const cx = w / 2;
  const cy = h / 2;

  // World-pixel bounds of the hero, converted to the tile indices that cover
  // it (one extra tile of slack on each edge for safety).
  const xtMin = Math.floor((px - cx) / 256) - 1;
  const xtMax = Math.floor((px + (w - cx)) / 256) + 1;
  const ytMin = Math.floor((py - cy) / 256) - 1;
  const ytMax = Math.floor((py + (h - cy)) / 256) + 1;

  let tiles = '';
  for (let tx = xtMin; tx <= xtMax; tx++) {
    for (let ty = ytMin; ty <= ytMax; ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n; // wrap longitude
      const left = cx + (tx * 256 - px);
      const top = cy + (ty * 256 - py);
      tiles += `<img src="https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${wx}/${ty}.png" referrerpolicy="no-referrer" alt="" style="position:absolute;left:${left}px;top:${top}px;width:256px;height:256px;">`;
    }
  }

  const pin = `<svg width="30" height="30" viewBox="0 0 24 24" fill="${BRAND_PINK}" stroke="#fff" stroke-width="1.5" style="position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-100%);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>`;

  return tiles + pin;
}

// Fill (or refill) a card's hero map with a tile mosaic sized to the hero's
// actual rendered pixels. Called after the card is in the DOM (and on resize),
// so the mosaic fits whatever width the layout gave the hero - fixing both the
// grey strip and the two-column detail hero, which have no fixed pixel width.
export function fillHeroMap(root: HTMLElement, cache: ParsedCache): void {
  const mapEl = root.querySelector('.pg-hero-map') as HTMLElement | null;
  if (!mapEl) return;
  const w = mapEl.clientWidth;
  const h = mapEl.clientHeight;
  if (!w || !h) return;
  mapEl.innerHTML = heroMapTiles(cache.lat, cache.lng, w, h);
}

// The hero: the cache photo on top of its map thumbnail, with a photo/map
// toggle (top-right) when a photo exists. The map always renders underneath,
// so toggling to "map" just hides the photo - and a broken photo URL reveals
// the map for free. `h` sets the hero height in pixels; the width is fluid
// (100%), and the tile mosaic is injected by `fillHeroMap` once laid out.
export function heroBlock(cache: ParsedCache, h: number): string {
  const map = `<div class="pg-hero-map" style="position:absolute;inset:0;overflow:hidden;background:#e5e7eb;"></div>`;
  const safeImg = cache.imageUrl ? sanitizeUrl(cache.imageUrl) : '';

  const photo = safeImg
    ? `<img class="pg-hero-photo" src="${safeImg}" alt="${escapeHtml(
        cache.name,
      )}" referrerpolicy="no-referrer" onerror="this.style.display='none'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;">`
    : '';

  const toggle = safeImg
    ? `<div style="position:absolute;top:8px;right:8px;z-index:2;display:flex;gap:3px;padding:3px;border-radius:9999px;background:rgba(0,0,0,0.55);">
         <button type="button" class="pg-hero-photo-btn" aria-label="Show photo" style="width:30px;height:30px;border:none;border-radius:9999px;background:${BRAND_PINK};display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">${svgIcon(
           ICON_CAMERA,
           '#fff',
           16,
         )}</button>
         <button type="button" class="pg-hero-map-btn" aria-label="Show map" style="width:30px;height:30px;border:none;border-radius:9999px;background:transparent;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;">${svgIcon(
           ICON_PIN,
           '#fff',
           16,
         )}</button>
       </div>`
    : '';

  return `<div style="position:relative;width:100%;height:${h}px;border-radius:10px;overflow:hidden;margin-bottom:12px;">${map}${photo}${toggle}</div>`;
}

// The "Hidden by …" attribution row (avatar + name + trust caveat). The name
// starts as an npub placeholder; loadHider upgrades it to the profile once
// resolved. Shared by the popup (inline) and the detail page (sidebar).
export function hiderRowHtml(_cache: ParsedCache): string {
  // The name starts as a skeleton bar (not an npub that would flash then flip
  // to the profile name); loadHider fills it once the kind-0 lookup settles.
  return `<div style="display:flex;gap:8px;align-items:flex-start;">
      <span class="pg-hider-avatar" style="flex:none;">${avatarHtml(null)}</span>
      <div style="min-width:0;flex:1;">
        <div class="pg-hider-name" style="font-size:12px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span class="pg-hider-skel" style="display:inline-block;width:96px;max-width:100%;height:11px;border-radius:6px;background:#e5e7eb;vertical-align:middle;"></span></div>
        <div style="font-size:11px;color:#9ca3af;font-style:italic;line-height:1.4;">Verify you trust them before going to the location.</div>
      </div>
    </div>`;
}

// A "how to claim" callout for prize Piglets: the sats are withdrawn by tapping
// the cache's NFC tag with the Lightning Piggy app. Shown on the detail page.
export function claimNoteHtml(cache: ParsedCache): string {
  if (!hasPrize(cache)) return '';
  return `
    <div style="margin-top:16px;display:flex;gap:9px;align-items:flex-start;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:11px 12px;">
      <span style="flex:none;margin-top:1px;">${ZAP_SVG}</span>
      <p style="font-size:12.5px;color:#78350f;line-height:1.5;">
        Found it? Claim the <strong>${cache.payoutSats!.toLocaleString()} sats</strong> by tapping the hidden NFC tag with the
        <a href="/app/" style="color:#b45309;font-weight:700;text-decoration:underline;">Lightning Piggy app</a>. <strong>#TapTheSats</strong>
      </p>
    </div>`;
}

// The shared middle of a cache card (everything between the hero and the
// find-log / call-to-action): icon + name, spec pills, rating meters,
// description, reveal-able hint, and the hider attribution row. The detail page
// moves the meters and hider into its right-hand sidebar, so it opts out with
// `includeMeters: false` / `includeHider: false`.
export function cacheBodyHtml(
  cache: ParsedCache,
  opts: { includeMeters?: boolean; includeHider?: boolean } = {},
): string {
  const includeMeters = opts.includeMeters !== false;
  const includeHider = opts.includeHider !== false;
  const iconBadge = iconBadgeHtml(cache.isLpPiggy, 24);

  const descBlock = cache.description
    ? `<p style="margin-top:12px;font-size:13px;color:#4b5563;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${escapeHtml(
        cache.description,
      )}</p>`
    : '';

  const hintBlock = cache.hint
    ? `<div style="margin-top:10px;">
         <button type="button" class="pg-hint-toggle" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:${BRAND_PINK};background:none;border:none;padding:0;cursor:pointer;">
           <span class="pg-hint-icon" style="display:inline-flex;">${svgIcon(
             ICON_EYE,
             BRAND_PINK,
             14,
           )}</span>
           <span class="pg-hint-label">Reveal hint</span>
         </button>
         <p class="pg-hint-text" style="display:none;margin-top:4px;font-size:13px;color:#4b5563;background:#f9fafb;border-radius:8px;padding:6px 8px;">${escapeHtml(
           cache.hint,
         )}</p>
       </div>`
    : '';

  return `
    <div style="display:flex;align-items:center;gap:7px;">
      ${iconBadge}
      <strong style="font-size:15px;color:#111827;line-height:1.2;">${escapeHtml(
        cache.name,
      )}</strong>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">${pillsHtml(cache)}</div>
    ${includeMeters ? metersHtml(cache) : ''}
    ${descBlock}
    ${hintBlock}
    ${includeHider ? `<div style="margin-top:12px;">${hiderRowHtml(cache)}</div>` : ''}
  `;
}

// Wire the interactive bits shared by the popup and the detail page: the
// hint reveal/hide toggle, the photo/map hero toggle, and resolving the
// hider's profile. Safe to call once per freshly-rendered card `root`.
export function wireCacheCard(root: HTMLElement, cache: ParsedCache): void {
  const toggle = root.querySelector('.pg-hint-toggle') as HTMLButtonElement | null;
  const text = root.querySelector('.pg-hint-text') as HTMLElement | null;
  const hintLabel = root.querySelector('.pg-hint-label') as HTMLElement | null;
  const hintIcon = root.querySelector('.pg-hint-icon') as HTMLElement | null;
  if (toggle && text) {
    toggle.addEventListener('click', () => {
      const shown = text.style.display !== 'none';
      text.style.display = shown ? 'none' : 'block';
      // `shown` is the state BEFORE this click: hidden→revealing swaps to
      // the eye-off "Hide hint" affordance, and vice versa.
      if (hintLabel) hintLabel.textContent = shown ? 'Reveal hint' : 'Hide hint';
      if (hintIcon) hintIcon.innerHTML = svgIcon(shown ? ICON_EYE : ICON_EYE_OFF, BRAND_PINK, 14);
    });
  }

  // Photo/map hero toggle: hide or show the photo layer (the map thumbnail
  // always sits underneath), and shade the active button pink.
  const photoEl = root.querySelector('.pg-hero-photo') as HTMLElement | null;
  const photoBtn = root.querySelector('.pg-hero-photo-btn') as HTMLElement | null;
  const mapBtn = root.querySelector('.pg-hero-map-btn') as HTMLElement | null;
  if (photoEl && photoBtn && mapBtn) {
    const setHeroView = (view: 'photo' | 'map') => {
      photoEl.style.display = view === 'photo' ? 'block' : 'none';
      photoBtn.style.background = view === 'photo' ? BRAND_PINK : 'transparent';
      mapBtn.style.background = view === 'map' ? BRAND_PINK : 'transparent';
    };
    photoBtn.addEventListener('click', () => setHeroView('photo'));
    mapBtn.addEventListener('click', () => setHeroView('map'));
  }

  // Resolve the "Hidden by …" attribution from its npub placeholder.
  const hiderName = root.querySelector('.pg-hider-name') as HTMLElement | null;
  const hiderAvatar = root.querySelector('.pg-hider-avatar') as HTMLElement | null;
  if (hiderName) loadHider(cache.hiderPubkey, hiderName, hiderAvatar).catch(() => {});

  // Fill the hero map mosaic now that the hero has a measurable size, and keep
  // it covering the hero as the viewport (and thus the hero width) changes.
  fillHeroMap(root, cache);
  const onResize = () => {
    if (!root.isConnected) {
      window.removeEventListener('resize', onResize);
      return;
    }
    fillHeroMap(root, cache);
  };
  window.addEventListener('resize', onResize);
}

// -----------------------------------------------------------------------
// Map popup (mirrors CacheDetailSheet)
// -----------------------------------------------------------------------
// The popup card's fixed inner width. The hero/map-thumbnail tile maths
// need a known pixel width to centre the pin, so the card is a fixed size
// rather than fluid.
const CARD_W = 320;
const HERO_H = 160;

// The map marker's popup: the cache card topped by the photo/map hero and
// tailed by a pink "View treasure" button that deep-links to the full
// /treasure/<naddr> page (the find log lives there, not here).
export function buildPopupHtml(cache: ParsedCache): string {
  const naddr = cacheNaddr(cache);
  return `
    <div style="width:${CARD_W}px;max-width:100%;font-family:Inter,system-ui,sans-serif;">
      ${heroBlock(cache, HERO_H)}
      ${cacheBodyHtml(cache)}
      <a href="/treasure/${naddr}?fromMap=true" style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px 16px;font-size:14px;font-weight:600;color:#fff;background:${BRAND_PINK};border-radius:9999px;text-decoration:none;">
        View treasure
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </a>
    </div>
  `;
}

// -----------------------------------------------------------------------
// Sharing (copy link + share to Nostr)
// -----------------------------------------------------------------------
// The canonical, shareable origin. Deep links always point at the live site
// (not localhost / a deploy preview) so a shared link works for everyone.
const SITE = 'https://lightningpiggy.com';

export interface ShareNote {
  content: string;
  tags: string[][];
  lpUrl: string;
  njumpUrl: string;
}

// Build the shareable links + the kind-1 note body/tags for a cache. The note
// links to the treasure on lightningpiggy.com (per project preference) and, as
// an `r` tag, njump - so Nostr clients that can't resolve the LP URL still have
// a portable pointer. `a` tags the addressable cache event; `t` tags surface it
// under the hunt hashtags.
export function buildShareNote(cache: ParsedCache): ShareNote {
  // A bare naddr keeps our own /treasure/<naddr> link short (our page resolves
  // it via GC_RELAYS). The njump link, however, is opened by other clients, so
  // it carries relay hints (a couple is plenty) so they can resolve the cache.
  const lpUrl = `${SITE}/treasure/${cacheNaddr(cache)}`;
  const njumpUrl = `https://njump.me/${cacheNaddr(cache, GC_RELAYS.slice(0, 2))}`;
  const prize =
    cache.isLpPiggy && cache.payoutSats != null
      ? ` — claim ⚡ ${cache.payoutSats.toLocaleString()} sats`
      : '';
  const content =
    `🐷 Treasure hunt: "${cache.name}" is hidden on the Lightning Piggy map${prize}.\n\n` +
    `Find it, scan it, keep the sats:\n${lpUrl}\n\n#treasurehunt #lightningpiggy #nostr`;

  const tags: string[][] = [
    ['a', cache.coord],
    ['r', lpUrl],
    ['r', njumpUrl],
    ['t', 'treasurehunt'],
    ['t', 'lightningpiggy'],
  ];
  const safeImg = cache.imageUrl ? sanitizeUrl(cache.imageUrl) : '';
  if (safeImg) tags.push(['image', safeImg]);

  return { content, tags, lpUrl, njumpUrl };
}

interface PublishResult {
  accepted: number; // relays that sent `OK … true`
  rejected: number; // relays that sent `OK … false` (explicit rejection)
  reached: number; // relays we opened a socket to and sent the EVENT
}

// Publish a signed event to every relay. Never rejects; resolves with counts so
// the caller can tell a real failure (nothing reached, or every reached relay
// rejected) from a slow relay that simply didn't ACK before the timeout - a
// timeout is not a failure, the event has usually still propagated.
function publishToRelays(event: { id: string }, relays: string[]): Promise<PublishResult> {
  return new Promise((resolve) => {
    let accepted = 0;
    let rejected = 0;
    let reached = 0;
    let settled = 0;
    const total = relays.length;
    const finish = () => {
      if (settled >= total) resolve({ accepted, rejected, reached });
    };
    for (const url of relays) {
      let ws: WebSocket;
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        try {
          ws.close();
        } catch {}
        settled++;
        finish();
      };
      try {
        ws = new WebSocket(url);
      } catch {
        settled++;
        finish();
        continue;
      }
      const timer = window.setTimeout(settle, 5000);
      ws.onopen = () => {
        reached++;
        ws.send(JSON.stringify(['EVENT', event]));
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg[0] === 'OK' && msg[1] === event.id) {
            if (msg[2]) accepted++;
            else rejected++;
            clearTimeout(timer);
            settle();
          }
        } catch {
          // ignore parse errors
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        settle();
      };
    }
  });
}

interface UnsignedTemplate {
  kind: number;
  tags: string[][];
  content: string;
}
interface SignedEvent {
  id: string;
  sig: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
}

// True when the browser exposes a NIP-07 signer (Alby, nos2x, …). The "login"
// on a static site is simply having such an extension: our writes call
// `window.nostr.signEvent`, which pops the extension's own approval prompt.
export function hasNostrSigner(): boolean {
  const nostr = (window as any).nostr;
  return !!nostr && typeof nostr.signEvent === 'function';
}

// Sign an event template with the NIP-07 signer and publish it to the relays.
// Throws `NO_SIGNER` (no extension - the UI prompts the user to connect one),
// `SIGN_FAILED` (rejected in the extension), or `PUBLISH_FAILED` (no relay
// accepted it). Returns the signed event + how many relays accepted it.
async function signAndPublish(
  template: UnsignedTemplate,
): Promise<{ event: SignedEvent; accepted: number }> {
  const nostr = (window as any).nostr;
  if (!nostr || typeof nostr.signEvent !== 'function') throw new Error('NO_SIGNER');

  const signed: SignedEvent = await nostr.signEvent({
    ...template,
    created_at: Math.floor(Date.now() / 1000),
  });
  if (!signed || !signed.id || !signed.sig) throw new Error('SIGN_FAILED');

  // The signer is connected now, so (re-)read the visitor's relays and publish
  // to their write relays as well as GC_RELAYS - their note lands on the relays
  // they and their followers actually use.
  resetUserRelays();
  const { accepted, rejected, reached } = await publishToRelays(signed, await writeRelays());
  // Success if any relay ACKed, or if we reached relays that didn't reject it
  // (a missing ACK is almost always a slow relay, not a rejection). Only a hard
  // failure - nothing reached, or every reached relay explicitly rejected -
  // throws. Report the best-effort count so the UI can say "posted to N".
  if (accepted > 0) return { event: signed, accepted };
  if (reached > rejected) return { event: signed, accepted: reached - rejected };
  throw new Error('PUBLISH_FAILED');
}

// Share a cache as a kind-1 note (the "Share to Nostr" modal). `contentOverride`
// lets the visitor edit the note before posting. Returns the relay accept count.
export async function shareToNostr(cache: ParsedCache, contentOverride?: string): Promise<number> {
  const note = buildShareNote(cache);
  const { accepted } = await signAndPublish({
    kind: 1,
    tags: note.tags,
    content: (contentOverride && contentOverride.trim()) || note.content,
  });
  return accepted;
}

// Post a note to a cache's find log as a NIP-22 comment (kind 1111) rooted at
// the cache's addressable event - so it shows up alongside the other finds
// (loadFindLog queries kind 1111 by the uppercase `A` root tag). Throws `EMPTY`
// for blank text, else the signer/publish errors above. Returns the signed
// event so the caller can optimistically render it.
export async function postFindLog(cache: ParsedCache, text: string): Promise<SignedEvent> {
  const content = (text || '').trim();
  if (!content) throw new Error('EMPTY');
  const kindStr = String(GC_CACHE_KIND);
  const { event } = await signAndPublish({
    kind: GC_COMMENT_KIND,
    content,
    tags: [
      ['A', cache.coord],
      ['K', kindStr],
      ['P', cache.hiderPubkey],
      ['a', cache.coord],
      ['k', kindStr],
      ['p', cache.hiderPubkey],
    ],
  });
  return event;
}

// -----------------------------------------------------------------------
// Zap the hider (NIP-57 Lightning zap)
// -----------------------------------------------------------------------
// A profile's resolved Lightning pay endpoint (lud16 address or lud06 LNURL),
// or null if they have neither. Ensures the profile is fetched first. Works for
// any pubkey (e.g. a cache's hider).
export async function lnAddressFor(pubkey: string): Promise<string | null> {
  await fetchProfiles([pubkey]);
  const prof = profileCache.get(pubkey);
  if (!prof) return null;
  return prof.lud16 || prof.lud06 || null;
}

// Resolve a lud16 Lightning address or lud06 LNURL to its LNURL-pay URL.
function lnurlPayUrl(addr: string): string | null {
  if (addr.includes('@')) {
    const [name, domain] = addr.split('@');
    if (!name || !domain) return null;
    return `https://${domain}/.well-known/lnurlp/${name}`;
  }
  // lud06: a bech32 `lnurl…` string wrapping the https URL.
  const dec = bech32Decode(addr);
  if (!dec || dec.hrp !== 'lnurl') return null;
  const bytes = convertBits(dec.data, 5, 8, false);
  if (!bytes) return null;
  const url = new TextDecoder().decode(new Uint8Array(bytes));
  return sanitizeUrl(url) || null;
}

export interface ZapOpts {
  content?: string; // zap-request note (NIP-57 kind-9734 content)
  aTag?: string; // optional cache coordinate to attribute the zap to
}

// Request a bolt11 zap invoice for `pubkey` `amountSats` via NIP-57 / LNURL-pay.
// Resolves their Lightning address, attaches a signed zap request when the
// endpoint and a NIP-07 signer allow it (so the zap shows on Nostr), and returns
// the invoice - the UI then lets the visitor choose how to pay (WebLN, QR, or
// any wallet). Throws `NO_ADDRESS`, `LNURL_FAILED`, `AMOUNT_RANGE`, `NO_INVOICE`.
export async function zapProfile(
  pubkey: string,
  amountSats: number,
  opts: ZapOpts = {},
): Promise<string> {
  const addr = await lnAddressFor(pubkey);
  if (!addr) throw new Error('NO_ADDRESS');
  const payUrl = lnurlPayUrl(addr);
  if (!payUrl) throw new Error('NO_ADDRESS');

  const meta = await fetch(payUrl)
    .then((r) => r.json())
    .catch(() => null);
  if (!meta || meta.status === 'ERROR' || !meta.callback) throw new Error('LNURL_FAILED');

  const amountMsat = Math.round(amountSats) * 1000;
  if (amountMsat < (meta.minSendable ?? 0) || amountMsat > (meta.maxSendable ?? Infinity)) {
    throw new Error('AMOUNT_RANGE');
  }

  let callback = `${meta.callback}${meta.callback.includes('?') ? '&' : '?'}amount=${amountMsat}`;

  // NIP-57: when the endpoint accepts a zap request and the visitor has a
  // signer, attach a signed kind-9734 so the paid zap is attributed on Nostr.
  const nostr = (window as any).nostr;
  if (meta.allowsNostr && meta.nostrPubkey && nostr?.signEvent) {
    try {
      const tags: string[][] = [
        ['relays', ...GC_RELAYS],
        ['amount', String(amountMsat)],
        ['p', pubkey],
      ];
      if (opts.aTag) tags.push(['a', opts.aTag]);
      const zapReq = await nostr.signEvent({
        kind: 9734,
        created_at: Math.floor(Date.now() / 1000),
        content: opts.content || 'Support on Lightning Piggy ⚡',
        tags,
      });
      callback += `&nostr=${encodeURIComponent(JSON.stringify(zapReq))}`;
    } catch {
      // Signer refused - fall back to a plain (non-attributed) LNURL-pay.
    }
  }

  // LUD-12: if the endpoint accepts comments, pass the note as `comment` too so
  // it's attached even for a plain (non-zap) LNURL-pay, within the allowed length.
  const commentMax = typeof meta.commentAllowed === 'number' ? meta.commentAllowed : 0;
  if (opts.content && commentMax > 0) {
    callback += `&comment=${encodeURIComponent(opts.content.slice(0, commentMax))}`;
  }

  const invoiceRes = await fetch(callback)
    .then((r) => r.json())
    .catch(() => null);
  const bolt11 = invoiceRes?.pr;
  if (!bolt11) throw new Error('NO_INVOICE');
  return bolt11;
}

// Zap a cache's hider, attributing the zap to that cache (detail-page wrapper).
export function zapHider(cache: ParsedCache, amountSats: number): Promise<string> {
  return zapProfile(cache.hiderPubkey, amountSats, {
    content: `Funding "${cache.name}" on Lightning Piggy ⚡`,
    aTag: cache.coord,
  });
}

// -----------------------------------------------------------------------
// Full detail page
// -----------------------------------------------------------------------
const DETAIL_HERO_H = 300;

// A labelled, monospace value row with a copy button (Coordinates, Geohash).
function detailRowHtml(label: string, value: string): string {
  return `<div style="margin-top:14px;">
    <div style="font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:3px;">
      <span style="flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(
        value,
      )}</span>
      <button type="button" class="pg-copy" data-copy="${escapeHtml(
        value,
      )}" aria-label="Copy ${label}" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:7px;background:#f3f4f6;color:#6b7280;cursor:pointer;">${svgIcon(
    ICON_COPY,
    '#6b7280',
    13,
  )}</button>
    </div>
  </div>`;
}

// The right-hand sidebar: a "Treasure details" card (rating meters,
// coordinates, geohash, directions) and a "Share" card (share to Nostr, copy
// link, native share) mirroring treasures.to's layout.
export function detailSidebarHtml(cache: ParsedCache): string {
  const meters = metersHtml(cache, { vertical: true });
  const coords = `${cache.lat.toFixed(6)}, ${cache.lng.toFixed(6)}`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${cache.lat},${cache.lng}`;
  const note = buildShareNote(cache);
  const shareGlyph = svgIcon(ICON_SHARE, '#fff', 15);

  // Support (zap) section - only for Piglets; revealed by the page once the
  // hider is confirmed to have a Lightning address.
  const support = cache.isLpPiggy
    ? `<div class="pg-support-section" hidden style="margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;">
         <div style="font-size:13px;font-weight:700;color:#111827;display:flex;align-items:center;gap:6px;">${ZAP_SVG} Support this treasure</div>
         <p style="margin-top:5px;font-size:12px;color:#6b7280;line-height:1.5;">
           Zap the hider to help fund the prize for future finders.
         </p>
         <button type="button" class="pg-zap-btn" style="margin-top:10px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:700;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
           ${ZAP_SVG} Zap the hider
         </button>
       </div>`
    : '';

  return `
    <div class="pg-side-card">
      <div style="font-size:14px;font-weight:700;color:#111827;">Treasure details</div>
      ${meters ? `<div style="margin-top:12px;">${meters}</div>` : ''}
      ${detailRowHtml('Coordinates', coords)}
      ${detailRowHtml('Geohash', cache.geohash)}
      <a href="${directions}" target="_blank" rel="noopener noreferrer" style="margin-top:16px;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:9px 14px;font-size:13px;font-weight:600;color:#111827;background:#f3f4f6;border-radius:10px;text-decoration:none;">
        ${svgIcon(ICON_NAV, '#111827', 15)} Get directions
      </a>
    </div>

    <div class="pg-side-card" style="margin-top:16px;">
      ${hiderRowHtml(cache)}
      ${support}
    </div>

    <div class="pg-side-card" style="margin-top:16px;">
      <div style="font-size:14px;font-weight:700;color:#111827;display:flex;align-items:center;gap:6px;">${svgIcon(
        ICON_SHARE,
        '#111827',
        15,
      )} Share this treasure</div>
      <button type="button" class="pg-share-nostr" style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:600;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
        ${shareGlyph} Share to Nostr
      </button>
      <button type="button" class="pg-share-copy" data-copy="${escapeHtml(
        note.lpUrl,
      )}" style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
        ${svgIcon(
          ICON_COPY,
          '#111827',
          15,
        )} <span class="pg-share-copy-label">Copy link</span>
      </button>
      <button type="button" class="pg-share-native" hidden style="margin-top:8px;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
        ${svgIcon(ICON_SHARE, '#111827', 15)} Share…
      </button>
    </div>
  `;
}

// The "Share to Nostr" composer, rendered once as a modal <dialog> on the
// detail page (opened from the sidebar's "Share to Nostr" button). Kept out of
// the sidebar so it overlays the page rather than expanding it. The textarea is
// filled with the note body when opened.
export function shareDialogHtml(): string {
  const shareGlyph = svgIcon(ICON_SHARE, '#fff', 15);
  return `
    <div style="font-family:Inter,system-ui,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#111827;">
          ${svgIcon(ICON_SHARE, BRAND_PINK, 18)} Share to Nostr
        </div>
        <button type="button" class="pg-share-close" aria-label="Close" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;background:#f3f4f6;color:#6b7280;cursor:pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p style="margin-top:6px;font-size:12.5px;color:#6b7280;line-height:1.5;">
        Post a note to your Nostr feed so it shows up on Primal, Damus and other clients. Signs with your browser extension (Alby / nos2x).
      </p>
      <textarea class="pg-share-text" rows="7" aria-label="Note to post" style="margin-top:10px;width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.5;color:#111827;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;resize:vertical;"></textarea>
      <div class="pg-share-status" role="status" style="margin-top:8px;font-size:12px;color:#6b7280;line-height:1.4;min-height:16px;"></div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button type="button" class="pg-share-modal-copy" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 14px;font-size:13px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
          ${svgIcon(ICON_COPY, '#111827', 15)} <span class="pg-share-modal-copy-label">Copy link</span>
        </button>
        <button type="button" class="pg-share-post" style="flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 14px;font-size:13px;font-weight:600;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
          ${shareGlyph} Post to Nostr
        </button>
      </div>
    </div>
  `;
}

// The "Log a find" composer, rendered once as a modal <dialog>. Posts a NIP-22
// comment to the cache's find log. Prompts to connect a signer when needed.
export function findLogDialogHtml(): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#111827;">
          ${svgIcon(ICON_PENCIL, BRAND_PINK, 18)} Log a find
        </div>
        <button type="button" class="pg-log-close" aria-label="Close" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;background:#f3f4f6;color:#6b7280;cursor:pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p style="margin-top:6px;font-size:12.5px;color:#6b7280;line-height:1.5;">
        Add a note to this treasure's find log. It's posted to Nostr and signed with your browser extension (Alby / nos2x).
      </p>
      <textarea class="pg-log-text" rows="4" placeholder="Found it! Great spot…" aria-label="Your find note" style="margin-top:10px;width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.5;color:#111827;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;resize:vertical;"></textarea>
      <div class="pg-log-status" role="status" style="margin-top:8px;font-size:12px;color:#6b7280;line-height:1.4;min-height:16px;"></div>
      <button type="button" class="pg-log-post" style="margin-top:6px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:600;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
        ${svgIcon(ICON_PENCIL, '#fff', 15)} Post to find log
      </button>
    </div>
  `;
}

// The zap modal <dialog>: amount presets + custom, a send button, and an
// invoice fallback area (shown when there's no WebLN wallet to pay in-browser).
// `title`/`description` let it read "Zap the hider" (detail) or "Zap <name>"
// Wired + opened by openZapDialog.
function zapDialogHtml(title: string, description: string): string {
  const presets = [21, 100, 500, 2100];
  const chips = presets
    .map(
      (a, i) =>
        `<button type="button" class="pg-zap-amount" data-sats="${a}" aria-pressed="${
          i === 0 ? 'true' : 'false'
        }" style="flex:1;padding:9px 4px;font-size:13px;font-weight:700;border-radius:10px;border:1px solid ${
          i === 0 ? BRAND_PINK : '#e5e7eb'
        };background:${i === 0 ? '#fce7f3' : '#fff'};color:#111827;cursor:pointer;">${a}</button>`,
    )
    .join('');
  return `
    <div style="font-family:Inter,system-ui,sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#111827;">
          ${ZAP_SVG} ${escapeHtml(title)}
        </div>
        <button type="button" class="pg-zap-close" aria-label="Close" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;background:#f3f4f6;color:#6b7280;cursor:pointer;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <p style="margin-top:6px;font-size:12.5px;color:#6b7280;line-height:1.5;">
        ${escapeHtml(description)}
      </p>
      <div class="pg-zap-amounts" style="display:flex;gap:8px;margin-top:12px;">${chips}</div>
      <input class="pg-zap-custom" type="number" min="1" inputmode="numeric" placeholder="Custom amount (sats)" style="margin-top:8px;width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;color:#111827;border:1px solid #e5e7eb;border-radius:10px;padding:9px 12px;" />
      <textarea class="pg-zap-comment" rows="2" maxlength="280" placeholder="Add a comment (optional)" aria-label="Zap comment" style="margin-top:8px;width:100%;box-sizing:border-box;font-family:inherit;font-size:13px;line-height:1.5;color:#111827;border:1px solid #e5e7eb;border-radius:10px;padding:9px 12px;resize:vertical;"></textarea>
      <button type="button" class="pg-zap-send" style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:11px 14px;font-size:14px;font-weight:700;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
        ${ZAP_SVG} <span class="pg-zap-send-label">Zap 21 sats</span>
      </button>
      <div class="pg-zap-status" role="status" style="margin-top:8px;font-size:12px;color:#6b7280;line-height:1.4;min-height:16px;"></div>
      <div class="pg-zap-invoice" hidden style="margin-top:8px;">
        <!-- Scannable QR of the bolt11 invoice for any mobile Lightning wallet -->
        <div class="pg-zap-qr" style="display:flex;justify-content:center;padding:12px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;"></div>
        <button type="button" class="pg-zap-webln" style="margin-top:8px;display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px 14px;font-size:13px;font-weight:700;color:#fff;background:${BRAND_PINK};border:none;border-radius:10px;cursor:pointer;">
          ${ZAP_SVG} Pay with WebLN
        </button>
        <div style="margin-top:8px;display:flex;gap:8px;">
          <button type="button" class="pg-zap-invoice-copy" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;font-size:12px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;cursor:pointer;">
            ${svgIcon(ICON_COPY, '#111827', 14)} <span class="pg-zap-invoice-copy-label">Copy invoice</span>
          </button>
          <a class="pg-zap-invoice-open" href="#" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 12px;font-size:12px;font-weight:600;color:#111827;background:#fff;border:1px solid #e5e7eb;border-radius:10px;text-decoration:none;">
            ${svgIcon(ICON_NAV, '#111827', 14)} Open in wallet
          </a>
        </div>
        <textarea class="pg-zap-invoice-text" rows="2" readonly aria-label="Lightning invoice" style="margin-top:8px;width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:#6b7280;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px;resize:none;"></textarea>
      </div>
    </div>
  `;
}

export interface ZapTarget {
  pubkey: string;
  title: string; // modal heading, e.g. "Zap the hider" or "Zap Alice"
  description: string; // sub-copy under the heading
  aTag?: string; // optional cache coordinate to attribute the zap
  zapContent?: string; // NIP-57 zap-request note
}

// Populate a <dialog> with the zap composer for `target`, wire it (amount
// presets, WebLN pay / invoice fallback, close), and open it. Shared by the
// detail page to zap a cache's hider (or any Nostr profile).
export function openZapDialog(dialog: HTMLDialogElement, target: ZapTarget): void {
  dialog.innerHTML = zapDialogHtml(target.title, target.description);
  const q = <T extends HTMLElement>(sel: string) => dialog.querySelector(sel) as T | null;
  const amounts = [...dialog.querySelectorAll<HTMLButtonElement>('.pg-zap-amount')];
  const custom = q<HTMLInputElement>('.pg-zap-custom');
  const commentEl = q<HTMLTextAreaElement>('.pg-zap-comment');
  const sendBtn = q<HTMLButtonElement>('.pg-zap-send');
  const sendLabel = q<HTMLElement>('.pg-zap-send-label');
  const status = q<HTMLElement>('.pg-zap-status');
  const invoiceBox = q<HTMLElement>('.pg-zap-invoice');
  const invoiceText = q<HTMLTextAreaElement>('.pg-zap-invoice-text');
  const invoiceOpen = q<HTMLAnchorElement>('.pg-zap-invoice-open');
  const invoiceCopy = q<HTMLButtonElement>('.pg-zap-invoice-copy');
  const invoiceCopyLabel = q<HTMLElement>('.pg-zap-invoice-copy-label');
  const qrBox = q<HTMLElement>('.pg-zap-qr');
  const weblnBtn = q<HTMLButtonElement>('.pg-zap-webln');

  const markPaid = () => {
    if (!status) return;
    status.style.color = '#16a34a';
    status.textContent = `Zapped ${amount.toLocaleString()} sats — thanks for supporting the hunt!`;
    if (invoiceBox) invoiceBox.hidden = true;
  };

  q<HTMLButtonElement>('.pg-zap-close')?.addEventListener('click', () => dialog.close());
  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.close();
  };

  let amount = 21;
  const highlight = (active: number | null) => {
    amounts.forEach((b) => {
      const on = active != null && Number(b.dataset.sats) === active;
      b.style.borderColor = on ? BRAND_PINK : '#e5e7eb';
      b.style.background = on ? '#fce7f3' : '#fff';
    });
  };
  const setAmount = (sats: number, fromPreset: boolean) => {
    amount = sats;
    if (sendLabel) sendLabel.textContent = `Zap ${sats.toLocaleString()} sats`;
    highlight(fromPreset ? sats : null);
  };
  amounts.forEach((b) =>
    b.addEventListener('click', () => {
      if (custom) custom.value = '';
      setAmount(Number(b.dataset.sats), true);
    }),
  );
  custom?.addEventListener('input', () => {
    const v = parseInt(custom.value, 10);
    if (v > 0) setAmount(v, false);
  });
  setAmount(21, true);

  const ZAP_ERRORS: Record<string, string> = {
    NO_ADDRESS: 'They have no Lightning address set on their profile.',
    AMOUNT_RANGE: "That amount is outside their allowed range. Try another.",
    LNURL_FAILED: "Couldn't reach their Lightning address. Please try again.",
    NO_INVOICE: "The Lightning service didn't return an invoice. Please try again.",
  };

  sendBtn?.addEventListener('click', async () => {
    if (!sendBtn || !status) return;
    sendBtn.disabled = true;
    status.style.color = '#6b7280';
    status.textContent = 'Requesting a Lightning invoice…';
    if (invoiceBox) invoiceBox.hidden = true;
    try {
      const invoice = await zapProfile(target.pubkey, amount, {
        content: commentEl?.value.trim() || target.zapContent,
        aTag: target.aTag,
      });
      status.style.color = '#6b7280';
      status.textContent = 'Invoice ready — pay with WebLN, scan the QR, or use any wallet:';
      if (invoiceText) invoiceText.value = invoice;
      if (invoiceOpen) invoiceOpen.href = `lightning:${invoice}`;
      if (qrBox) qrBox.innerHTML = `<div style="width:190px;max-width:100%;">${qrSvg(invoice)}</div>`;

      // "Pay with WebLN" is always shown; if no wallet is present, say so and
      // point at the QR / other options rather than doing nothing.
      if (weblnBtn) {
        weblnBtn.onclick = async () => {
          const webln = (window as any).webln;
          if (!webln || typeof webln.sendPayment !== 'function') {
            status.style.color = '#b91c1c';
            status.textContent =
              'No WebLN wallet detected. Install Alby or nos2x, or scan the QR / open in your wallet.';
            return;
          }
          weblnBtn.disabled = true;
          status.style.color = '#6b7280';
          status.textContent = 'Paying with WebLN…';
          try {
            await webln.enable();
            await webln.sendPayment(invoice);
            markPaid();
          } catch {
            status.style.color = '#b91c1c';
            status.textContent = 'WebLN payment failed or was cancelled. Scan the QR or copy the invoice.';
          } finally {
            weblnBtn.disabled = false;
          }
        };
      }
      if (invoiceBox) invoiceBox.hidden = false;
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      status.style.color = '#b91c1c';
      status.textContent = ZAP_ERRORS[code] || 'Could not create the zap. Please try again.';
    } finally {
      sendBtn.disabled = false;
    }
  });

  invoiceCopy?.addEventListener('click', async () => {
    if (!invoiceText) return;
    try {
      await navigator.clipboard.writeText(invoiceText.value);
    } catch {
      return;
    }
    if (invoiceCopyLabel) {
      invoiceCopyLabel.textContent = 'Copied!';
      window.setTimeout(() => {
        if (invoiceCopyLabel.isConnected) invoiceCopyLabel.textContent = 'Copy invoice';
      }, 1300);
    }
  });

  dialog.showModal();
}

// The full-page treasure view: a two-column layout matching treasures.to - the
// map, cache card and find log on the left, a "Treasure details"/"Share"
// sidebar on the right. Collapses to a single column on narrow screens via the
// page's CSS. Rendered client side for a given naddr.
export function buildDetailHtml(cache: ParsedCache): string {
  return `
    <div class="pg-detail-grid" style="font-family:Inter,system-ui,sans-serif;">
      <div class="pg-detail-left">
        <div class="pg-detail-main" style="min-width:0;">
          ${heroBlock(cache, DETAIL_HERO_H)}
          ${cacheBodyHtml(cache, { includeMeters: false, includeHider: false })}
          ${claimNoteHtml(cache)}
        </div>
        <div class="pg-detail-findlog">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
            <div style="font-size:15px;font-weight:700;color:#111827;">Find log</div>
            <button type="button" class="pg-findlog-add" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;font-size:12px;font-weight:600;color:#fff;background:${BRAND_PINK};border:none;border-radius:9999px;cursor:pointer;">
              ${svgIcon(ICON_PENCIL, '#fff', 13)} Log a find
            </button>
          </div>
          <div class="pg-findlog-body" style="font-size:12px;color:#6b7280;">Loading finds…</div>
        </div>
      </div>
      <aside class="pg-detail-side">
        ${detailSidebarHtml(cache)}
      </aside>
    </div>
  `;
}
