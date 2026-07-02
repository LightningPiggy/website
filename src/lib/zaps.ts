// zaps.ts
// Pure, isomorphic (browser + Node) helpers for NIP-57 zap receipts (kind 9735).
// Used by the /donate "wall of zappers" island — and unit-tested directly in
// Node (e2e/zaps.unit.mjs) against synthetic receipts, so the aggregation +
// threshold logic is verified without ever publishing a real zap.

// Self-contained (no ./market import) so Node can run it directly with
// --experimental-strip-types — extensionless TS imports don't resolve there.
export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}
const tagVal = (t: string[][], k: string): string | undefined => t.find((x) => x[0] === k)?.[1];

export interface ParsedZap {
  zapper: string; // hex pubkey of the SENDER (from the embedded zap request)
  msats: number; // zap amount in millisats
}

// Amount encoded in a bolt11 invoice's human-readable part, in millisats.
// `lnbc21u1p…` → 21 micro-BTC → 2,100,000 msats. Returns 0 when absent/invalid.
// (1 BTC = 1e11 msats; m/u/n/p are the standard bolt11 multipliers.)
// Integer arithmetic throughout: `p` (pico-BTC) is 0.1 msat per unit and the
// BOLT11 spec requires pico amounts to end in 0 (whole msats) — a sub-msat
// amount like lnbc15p is INVALID and is rejected, never rounded up.
export function bolt11Msats(pr: string): number {
  const s = String(pr || '').toLowerCase();
  if (!s.startsWith('ln')) return 0;
  const sep = s.lastIndexOf('1'); // bech32 separator = LAST '1' in the string
  if (sep < 3) return 0;
  const m = /^ln[a-z]+?(\d+)([munp]?)$/.exec(s.slice(0, sep));
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  if (!Number.isSafeInteger(num) || num <= 0) return 0;
  if (m[2] === 'p') {
    if (num % 10 !== 0) return 0; // sub-msat precision — invalid per BOLT11
    return num / 10;
  }
  const mult: Record<string, number> = { '': 1e11, m: 1e8, u: 1e5, n: 100 };
  const msats = num * mult[m[2]];
  return Number.isSafeInteger(msats) && msats > 0 ? msats : 0;
}

// Sanity ceiling for relay-supplied amounts: 21,000 BTC in msats (2.1e15 —
// comfortably inside Number.MAX_SAFE_INTEGER ≈ 9e15, and orders of magnitude
// above any plausible donation). Larger claims are hostile/garbage and are
// rejected (per receipt) or clamped (totals) so every computation stays in
// exact-integer territory.
export const MAX_ZAP_MSATS = 21_000 * 1e11; // 2.1e15 (1 BTC = 1e11 msats)

// Parse one kind-9735 zap receipt into { zapper, msats }.
//   • sender  = `pubkey` of the zap request JSON embedded in the receipt's
//     `description` tag (the receipt itself is signed by the LNURL server's
//     key, NOT the sender — so the receipt's own pubkey is useless here);
//   • amount  = the zap request's `amount` tag (millisats, per NIP-57), falling
//     back to the amount encoded in the receipt's `bolt11` tag.
// Returns null for anything malformed rather than throwing — receipts are
// relay-supplied and arbitrarily hostile.
export function parseZapReceipt(ev: NostrEvent): ParsedZap | null {
  if (!ev || ev.kind !== 9735 || !Array.isArray(ev.tags)) return null;
  const desc = tagVal(ev.tags, 'description');
  if (!desc) return null;
  let zr: any;
  try {
    zr = JSON.parse(desc);
  } catch {
    return null;
  }
  const zapper =
    typeof zr?.pubkey === 'string' && /^[0-9a-f]{64}$/.test(zr.pubkey) ? zr.pubkey : '';
  if (!zapper) return null;
  let msats = 0;
  if (Array.isArray(zr.tags)) {
    const amt = zr.tags.find((t: any) => Array.isArray(t) && t[0] === 'amount')?.[1];
    // Bounded digit count + safe-integer + supply-cap checks: a hostile
    // `amount` string can't smuggle in an imprecise float or absurd total.
    if (typeof amt === 'string' && /^\d{1,16}$/.test(amt)) {
      const n = parseInt(amt, 10);
      if (Number.isSafeInteger(n) && n <= MAX_ZAP_MSATS) msats = n;
    }
  }
  if (!msats) msats = bolt11Msats(tagVal(ev.tags, 'bolt11') || '');
  if (msats > MAX_ZAP_MSATS) return null; // more than all bitcoin — hostile
  return msats > 0 ? { zapper, msats } : null;
}

// Sum zap amounts per sender across a pile of receipts (relay responses may
// repeat events, so de-dupe by event id first). Returns hex pubkey → total msats.
// Totals are clamped to MAX_ZAP_MSATS so even a flood of maxed-out hostile
// receipts can't push a sum past Number.MAX_SAFE_INTEGER and corrupt
// ordering/threshold comparisons.
export function aggregateZaps(events: NostrEvent[]): Map<string, number> {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const ev of events || []) {
    if (!ev?.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const z = parseZapReceipt(ev);
    if (!z) continue;
    totals.set(z.zapper, Math.min((totals.get(z.zapper) || 0) + z.msats, MAX_ZAP_MSATS));
  }
  return totals;
}

// The zappers whose TOTAL meets the threshold (in sats), biggest first.
export function topZappers(
  events: NostrEvent[],
  thresholdSats: number,
): { pubkey: string; sats: number }[] {
  const out: { pubkey: string; sats: number }[] = [];
  for (const [pubkey, msats] of aggregateZaps(events)) {
    const sats = Math.floor(msats / 1000);
    if (sats >= thresholdSats) out.push({ pubkey, sats });
  }
  return out.sort((a, b) => b.sats - a.sats);
}

// $usd worth of sats at the given BTC/USD rate, rounded to the NEAREST 1,000
// sats (so the wall's bar doesn't wobble with every tick). Falls back to
// 50,000 sats when the rate is missing/absurd.
export const FALLBACK_THRESHOLD_SATS = 50_000;
export function thresholdSatsForUsd(usdPerBtc: number, usd = 50): number {
  if (!Number.isFinite(usdPerBtc) || usdPerBtc <= 0) return FALLBACK_THRESHOLD_SATS;
  const sats = (usd / usdPerBtc) * 1e8;
  const rounded = Math.round(sats / 1000) * 1000;
  return rounded >= 1000 ? rounded : 1000;
}
