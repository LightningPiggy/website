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

// Fan the same filter set across every relay, then dedupe by event id (the
// same event echoes back from multiple relays).
export async function fetchEvents(filters: Record<string, unknown>[]): Promise<NostrEvent[]> {
  const results = await Promise.all(GC_RELAYS.map((r) => reqFromRelay(r, filters)));
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

// A finder's resolved Nostr profile (kind-0 metadata): the bits we render.
export interface FinderProfile {
  name: string | null;
  picture: string | null;
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

  for (const pk of missing) {
    const ev = newest.get(pk);
    if (!ev) {
      profileCache.set(pk, { name: null, picture: null });
      continue;
    }
    try {
      const meta = JSON.parse(ev.content || '{}');
      const picture = typeof meta.picture === 'string' ? sanitizeUrl(meta.picture) : '';
      profileCache.set(pk, {
        name: meta.display_name || meta.displayName || meta.name || null,
        picture: picture || null,
      });
    } catch {
      profileCache.set(pk, { name: null, picture: null });
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

// The naddr coordinate for a parsed cache: /treasure/<naddr> deep-link target.
export function cacheNaddr(cache: ParsedCache): string {
  return naddrEncode({
    kind: GC_CACHE_KIND,
    pubkey: cache.hiderPubkey,
    identifier: cache.d,
    relays: [],
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

// Resolve the hider's profile and upgrade the "Hidden by …" row from its
// npub placeholder to the hider's name + avatar once it arrives.
async function loadHider(
  pubkey: string,
  nameEl: HTMLElement | null,
  avatarEl: HTMLElement | null,
): Promise<void> {
  await fetchProfiles([pubkey]);
  const prof = profileCache.get(pubkey);
  if (!prof) return;
  if (prof.name && nameEl?.isConnected) nameEl.textContent = `Hidden by ${prof.name}`;
  if (prof.picture && avatarEl?.isConnected) avatarEl.innerHTML = avatarHtml(prof.picture);
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
function metersHtml(cache: ParsedCache): string {
  const meters: string[] = [];
  if (cache.difficulty != null) meters.push(meterHtml('Difficulty', cache.difficulty));
  if (cache.terrain != null) meters.push(meterHtml('Terrain', cache.terrain));
  const sizeVal = cache.size ? SIZE_RANK[cache.size.toLowerCase()] : undefined;
  if (sizeVal != null) meters.push(meterHtml('Size', sizeVal));
  if (meters.length === 0) return '';
  return `<div style="display:flex;gap:12px;margin-top:12px;">${meters.join('')}</div>`;
}

// Web-mercator world-pixel position of a lng/lat at a given zoom.
function lngLatToWorldPx(lng: number, lat: number, z: number): { x: number; y: number } {
  const scale = 256 * Math.pow(2, z);
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

// A static map thumbnail centred on the cache: a 3x3 mosaic of CARTO raster
// tiles (the same basemap the live map uses) clipped to the hero, with a
// centre pin. No interactivity, no extra library - just <img> tiles. The
// caller passes the hero pixel size so the pin stays centred at any width.
function mapThumbHtml(lat: number, lng: number, w: number, h: number): string {
  const z = 14;
  const n = Math.pow(2, z);
  const { x: px, y: py } = lngLatToWorldPx(lng, lat, z);
  const cx = w / 2;
  const cy = h / 2;
  const xt = Math.floor(px / 256);
  const yt = Math.floor(py / 256);

  let tiles = '';
  for (let tx = xt - 1; tx <= xt + 1; tx++) {
    for (let ty = yt - 1; ty <= yt + 1; ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n; // wrap longitude
      const left = cx + (tx * 256 - px);
      const top = cy + (ty * 256 - py);
      tiles += `<img src="https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${wx}/${ty}.png" referrerpolicy="no-referrer" alt="" style="position:absolute;left:${left}px;top:${top}px;width:256px;height:256px;">`;
    }
  }

  const pin = `<svg width="30" height="30" viewBox="0 0 24 24" fill="${BRAND_PINK}" stroke="#fff" stroke-width="1.5" style="position:absolute;left:${cx}px;top:${cy}px;transform:translate(-50%,-100%);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>`;

  return `<div class="pg-hero-map" style="position:absolute;inset:0;overflow:hidden;background:#e5e7eb;">${tiles}${pin}</div>`;
}

// The hero: the cache photo on top of its map thumbnail, with a photo/map
// toggle (top-right) when a photo exists. The map always renders underneath,
// so toggling to "map" just hides the photo - and a broken photo URL reveals
// the map for free. `w`/`h` size the hero in pixels (the map mosaic needs a
// known size to centre the pin).
export function heroBlock(cache: ParsedCache, w: number, h: number): string {
  const map = mapThumbHtml(cache.lat, cache.lng, w, h);
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

// The shared middle of a cache card (everything between the hero and the
// find-log / call-to-action): icon + name, spec pills, rating meters,
// description, reveal-able hint, and the hider attribution row.
export function cacheBodyHtml(cache: ParsedCache): string {
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
    ${metersHtml(cache)}
    ${descBlock}
    ${hintBlock}
    <div style="margin-top:12px;display:flex;gap:8px;align-items:flex-start;">
      <span class="pg-hider-avatar" style="flex:none;">${avatarHtml(null)}</span>
      <div style="min-width:0;flex:1;">
        <div class="pg-hider-name" style="font-size:12px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Hidden by ${escapeHtml(
          shortNpub(cache.hiderPubkey),
        )}</div>
        <div style="font-size:11px;color:#9ca3af;font-style:italic;line-height:1.4;">Verify you trust them before going to the location.</div>
      </div>
    </div>
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
      ${heroBlock(cache, CARD_W, HERO_H)}
      ${cacheBodyHtml(cache)}
      <a href="/treasure/${naddr}?fromMap=true" style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px 16px;font-size:14px;font-weight:600;color:#fff;background:${BRAND_PINK};border-radius:9999px;text-decoration:none;">
        View treasure
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
      </a>
    </div>
  `;
}

// -----------------------------------------------------------------------
// Full detail page
// -----------------------------------------------------------------------
// The full-page treasure card: the same hero + body as the popup, followed by
// the find log inline (rather than a "View treasure" button). Rendered client
// side into the detail page for a given naddr. `heroW`/`heroH` size the hero
// for the current viewport.
export function buildDetailHtml(cache: ParsedCache, heroW: number, heroH: number): string {
  return `
    <div style="font-family:Inter,system-ui,sans-serif;">
      ${heroBlock(cache, heroW, heroH)}
      ${cacheBodyHtml(cache)}
      <div style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;">
        <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">Find log</div>
        <div class="pg-findlog-body" style="font-size:12px;color:#6b7280;">Loading finds…</div>
      </div>
    </div>
  `;
}
