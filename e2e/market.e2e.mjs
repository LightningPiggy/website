// Self-cleaning end-to-end test for the market's reviews & comments flow.
//
// Drives a real browser (Playwright): signs in with a fresh throwaway Nostr key,
// posts a comment and a review, checks they appear without a refresh and show
// the profile name, then DELETES each via its trash icon and checks it's gone.
// A NIP-09 cleanup always runs at the end as a safety net, so no test posts are
// left on the public relays even if an assertion fails.
//
// Prerequisites:
//   1. Build + serve:            npm run build && npm run preview
//      (preview, not dev, so product pages don't 404 on a flaky build-time relay
//       fetch. Override with BASE_URL=... if needed.)
//   2. Install the browser once:  npx playwright install chromium
// Run:  npm run test:e2e

import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const PRODUCT = process.env.PRODUCT_PATH || '/market/p/robotechy--product-1768341630046-c91xy';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];

const pool = new SimplePool();
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fresh throwaway identity per run — so runs never accumulate state and cleanup
// only ever touches this run's own posts.
const sk = generateSecretKey();
const pub = getPublicKey(sk);
const nsec = nsecEncode(sk);

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failed = true;
};

async function waitFor(fn, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
}

// Safety net: remove any comment (1111) / review (31555) this key still has.
async function cleanup() {
  const mine = await pool.querySync(RELAYS, { authors: [pub], kinds: [1111, 31555] }, { maxWait: 6000 });
  if (!mine.length) {
    console.log('🧹 cleanup: nothing left to remove');
    return;
  }
  const del = finalizeEvent(
    { kind: 5, created_at: nowSec(), tags: [...mine.map((e) => ['e', e.id])], content: 'e2e cleanup' },
    sk,
  );
  await Promise.any(pool.publish(RELAYS, del)).catch(() => {});
  await sleep(2500);
  const after = await pool.querySync(RELAYS, { authors: [pub], kinds: [1111, 31555] }, { maxWait: 6000 });
  const remaining = after.filter((e) => mine.some((x) => x.id === e.id)).length;
  // Publishing the deletion is what we control; some relays ignore/lag NIP-09,
  // so a residual copy on one relay is expected and not a failure. Our site and
  // compliant relays/clients hide it.
  console.log(
    `🧹 cleanup: deletion published for ${mine.length} leftover post(s); ${remaining} still cached on a non-compliant relay`,
  );
}

async function run() {
  // Publish a profile so posts render a display name.
  const profile = finalizeEvent(
    { kind: 0, created_at: nowSec(), tags: [], content: JSON.stringify({ name: 'E2E Test', display_name: 'E2E Test' }) },
    sk,
  );
  await Promise.any(pool.publish(RELAYS, profile)).catch(() => {});
  await sleep(2000);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', (d) => d.accept()); // auto-accept the delete confirm
  try {
    await page.goto(BASE + PRODUCT, { waitUntil: 'networkidle' });
    ok((await page.locator('#buy-btn').count()) > 0, 'product page loaded');

    // Sign in with the throwaway nsec.
    await page.locator('#hdr-signin').click();
    await page.locator('#nlm-tab-key').click();
    await page.locator('#nlm-nsec').fill(nsec);
    await page.locator('#nlm-key-btn').click();
    await page.locator('#hdr-account').waitFor({ state: 'visible', timeout: 20000 });
    ok(/E2E Test/.test((await page.locator('#hdr-name').textContent()) || ''), 'signed in with profile name');

    // --- Comment: add → verify → delete via trash icon ---
    await page.locator('#tab-comments').click();
    const cmsg = 'e2e comment ' + Date.now();
    await page.locator('#comment-text').fill(cmsg);
    await page.locator('#comment-form button[type=submit]').click();
    const cCard = page.locator('#comments-list > div', { hasText: cmsg });
    ok(await waitFor(async () => (await cCard.count()) > 0), 'comment appears without a refresh');
    ok(((await cCard.first().textContent()) || '').includes('E2E Test'), 'comment shows the display name');
    ok((await cCard.first().locator('.post-delete').count()) > 0, 'own comment has a trash icon');
    await cCard.first().locator('.post-delete').click();
    ok(await waitFor(async () => (await page.locator('#comments-list > div', { hasText: cmsg }).count()) === 0),
       'comment removed via the trash icon');

    // --- Review: add → verify → delete via trash icon ---
    await page.locator('#tab-reviews').click();
    await page.locator('#star-input .star[data-value="5"]').click();
    const rmsg = 'e2e review ' + Date.now();
    await page.locator('#review-text').fill(rmsg);
    await page.locator('#review-form button[type=submit]').click();
    const rCard = page.locator('#reviews-list > div', { hasText: rmsg });
    ok(await waitFor(async () => (await rCard.count()) > 0), 'review appears without a refresh');
    ok((await rCard.first().locator('.post-delete').count()) > 0, 'own review has a trash icon');
    await rCard.first().locator('.post-delete').click();
    ok(await waitFor(async () => (await page.locator('#reviews-list > div', { hasText: rmsg }).count()) === 0),
       'review removed via the trash icon');
  } finally {
    await browser.close();
  }
}

try {
  await run();
} catch (e) {
  failed = true;
  console.error('❌ threw:', e.message);
} finally {
  await cleanup(); // always runs, so test posts never linger
  pool.close(RELAYS);
  console.log(failed ? '\n=== FAIL ===' : '\n=== PASS (and cleaned up) ===');
  process.exit(failed ? 1 : 0);
}
