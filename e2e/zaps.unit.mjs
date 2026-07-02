// Unit tests for the /donate wall-of-zappers logic (src/lib/zaps.ts) against
// SYNTHETIC kind-9735 zap receipts — nothing touches the network and nothing
// is ever published, so the aggregation/threshold logic is verified without
// polluting the real project's zap history.
//
// Run from the repo root:
//   node --experimental-strip-types e2e/zaps.unit.mjs

import {
  bolt11Msats,
  parseZapReceipt,
  aggregateZaps,
  topZappers,
  thresholdSatsForUsd,
  FALLBACK_THRESHOLD_SATS,
} from '../src/lib/zaps.ts';

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failed = true;
};
const eq = (got, want, msg) => ok(got === want, `${msg} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const SERVER = 'f'.repeat(64); // the LNURL server key that SIGNS receipts

let n = 0;
// A receipt as an LNURL server would publish it: the sender + amount live in
// the embedded zap request (description tag), not on the receipt itself.
function receipt({ sender, amountMsats, bolt11, id }) {
  const zapRequest = {
    kind: 9734,
    pubkey: sender,
    created_at: 1700000000,
    content: 'test zap',
    tags: [
      ['p', 'd'.repeat(64)],
      ...(amountMsats != null ? [['amount', String(amountMsats)]] : []),
      ['relays', 'wss://relay.example'],
    ],
  };
  return {
    id: id || `ev${n++}`,
    pubkey: SERVER,
    kind: 9735,
    content: '',
    created_at: 1700000001,
    tags: [
      ['p', 'd'.repeat(64)],
      ['description', JSON.stringify(zapRequest)],
      ...(bolt11 ? [['bolt11', bolt11]] : []),
    ],
  };
}

// ---- bolt11 amount parsing ----
eq(bolt11Msats('lnbc210u1pjfake'), 21_000_000, 'lnbc210u → 21,000 sats in msats');
eq(bolt11Msats('lnbc1m1pjfake'), 100_000_000, 'lnbc1m → 100,000 sats in msats');
eq(bolt11Msats('lnbc500n1pjfake'), 50_000, 'lnbc500n → 50 sats in msats');
eq(bolt11Msats('lnbc1pjfake'), 0, 'amountless invoice → 0');
eq(bolt11Msats(''), 0, 'empty string → 0');
eq(bolt11Msats('garbage'), 0, 'garbage → 0');

// ---- parseZapReceipt ----
const r1 = parseZapReceipt(receipt({ sender: ALICE, amountMsats: 5_000_000 }));
ok(r1 && r1.zapper === ALICE && r1.msats === 5_000_000, 'amount tag in zap request wins');

const r2 = parseZapReceipt(receipt({ sender: BOB, amountMsats: null, bolt11: 'lnbc100u1pjfake' }));
ok(r2 && r2.zapper === BOB && r2.msats === 10_000_000, 'missing amount tag falls back to bolt11 (10,000 sats)');

eq(parseZapReceipt(receipt({ sender: 'not-a-pubkey', amountMsats: 1000 })), null, 'invalid sender pubkey rejected');
eq(parseZapReceipt(receipt({ sender: ALICE, amountMsats: null })), null, 'no amount anywhere rejected');
eq(
  parseZapReceipt({ id: 'x', pubkey: SERVER, kind: 9735, content: '', created_at: 1, tags: [['description', '{{{']] }),
  null,
  'malformed description JSON rejected',
);
eq(parseZapReceipt({ ...receipt({ sender: ALICE, amountMsats: 1000 }), kind: 1 }), null, 'non-9735 kind rejected');

// ---- aggregation: totals PER ZAPPER, de-duped by event id ----
const events = [
  receipt({ sender: ALICE, amountMsats: 30_000_000, id: 'dup' }), // 30k sats
  receipt({ sender: ALICE, amountMsats: 30_000_000, id: 'dup' }), // same event from another relay — ignored
  receipt({ sender: ALICE, amountMsats: 25_000_000 }), // +25k sats → alice 55k total
  receipt({ sender: BOB, amountMsats: 49_999_000 }), // bob 49,999 sats — just under
  receipt({ sender: CAROL, amountMsats: null, bolt11: 'lnbc600u1pjfake' }), // carol 60k via bolt11
  receipt({ sender: 'bad', amountMsats: 1_000_000 }), // malformed — skipped
];
const totals = aggregateZaps(events);
eq(totals.get(ALICE), 55_000_000, 'alice total sums across zaps (relay dupes dropped)');
eq(totals.get(BOB), 49_999_000, 'bob total');
eq(totals.get(CAROL), 60_000_000, 'carol total from bolt11 fallback');
eq(totals.size, 3, 'malformed receipt contributes nothing');

// ---- threshold filter: TOTAL >= threshold, biggest first ----
const top = topZappers(events, 50_000);
eq(top.length, 2, 'only totals >= 50,000 sats make the wall');
eq(top[0].pubkey, CAROL, 'sorted biggest first (carol 60k)');
eq(top[1].pubkey, ALICE, 'alice (55k) qualifies via her SUMMED zaps');
eq(top[1].sats, 55_000, 'sats reported in whole sats');
ok(!top.some((z) => z.pubkey === BOB), 'bob at 49,999 stays off the wall');

// ---- $50 → sats threshold, rounded to the nearest 1,000 ----
eq(thresholdSatsForUsd(100_000), 50_000, '$50 at $100k/BTC → 50,000 sats');
eq(thresholdSatsForUsd(113_000), 44_000, '$50 at $113k/BTC → 44,248 rounds to 44,000');
eq(thresholdSatsForUsd(76_000), 66_000, '$50 at $76k/BTC → 65,789 rounds to 66,000');
eq(thresholdSatsForUsd(0), FALLBACK_THRESHOLD_SATS, 'zero rate → 50,000-sat fallback');
eq(thresholdSatsForUsd(NaN), FALLBACK_THRESHOLD_SATS, 'NaN rate → 50,000-sat fallback');

console.log(failed ? '\n❌ zaps unit tests FAILED' : '\n✅ all zaps unit tests passed');
process.exit(failed ? 1 : 0);
