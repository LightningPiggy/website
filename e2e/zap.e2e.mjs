// End-to-end test for the /donate zap page (self-cleaning: nothing is ever
// published — the flow under test is the SIGNED-OUT fallback, which only
// fetches a real LNURL invoice and pays nothing).
//
// Checks:
//   • header shows the zap icon button (and no "Donate" text entry),
//   • the wall of zappers island resolves (avatars or the empty state),
//   • presets are denominated in SATS,
//   • a signed-out custom amount produces a real bolt11 invoice + QR +
//     lightning: link (LNURL fetch against the live endpoint),
//   • a stubbed window.webln makes the "Pay with WebLN" button appear and
//     the stub receives the same bolt11 when clicked.
//
// Prerequisites:  npm run build && npx astro preview --port 4322
// Run:            node e2e/zap.e2e.mjs

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4322';

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failed = true;
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Stub WebLN BEFORE any page script runs.
  await page.addInitScript(() => {
    window.__weblnPaid = [];
    window.webln = {
      enable: async () => {},
      sendPayment: async (pr) => {
        window.__weblnPaid.push(pr);
        return { preimage: 'stub' };
      },
    };
  });

  await page.goto(`${BASE}/donate`, { waitUntil: 'domcontentloaded' });

  // --- header: zap icon replaces the Donate text entry ---
  ok((await page.locator('#hdr-icons a[href="/donate"]').count()) === 1, 'header icon cluster has the zap /donate button');
  ok(
    (await page.locator('header nav a', { hasText: /^Donate$/ }).count()) === 0,
    'no "Donate" text entry left in the header nav',
  );
  const aria = await page.locator('#hdr-icons a[href="/donate"]').getAttribute('aria-label');
  ok(!!aria && /zap/i.test(aria), `zap button has an aria-label (${aria})`);

  // --- presets are sats-denominated ---
  const presets = await page.locator('#zap-presets .preset-btn').allTextContents();
  ok(presets.length === 5, `5 preset buttons (${presets.join(' | ')})`);
  ok(
    presets.every((t) => /^[\d,]+$/.test(t.trim())) && presets.some((t) => t.trim() === '21,000'),
    'presets are plain sats values (incl. 21,000), no $ anywhere',
  );
  ok((await page.locator('#zap-presets').textContent()).indexOf('$') === -1, 'no dollar signs in presets');
  ok((await page.locator('#zap-amount').getAttribute('placeholder')).toLowerCase().includes('sats'), 'custom input is sats-denominated');

  // --- wall island resolves: avatars or a tasteful empty state ---
  await page.waitForFunction(
    () =>
      !document.getElementById('wall-avatars').classList.contains('hidden') ||
      !document.getElementById('wall-empty').classList.contains('hidden'),
    null,
    { timeout: 25000 },
  );
  const avatarCount = await page.locator('#wall-avatars a').count();
  const emptyShown = await page.locator('#wall-empty').isVisible();
  ok(avatarCount > 0 || emptyShown, `wall resolved (${avatarCount} avatars${emptyShown ? ', empty state shown' : ''})`);
  ok(await page.locator('#wall-skeleton').isHidden(), 'loading skeleton cleared');
  if (avatarCount > 0) {
    const href = await page.locator('#wall-avatars a').first().getAttribute('href');
    ok(/^https:\/\/njump\.me\/npub1[a-z0-9]+$/.test(href), `avatars link to njump profiles (${href.slice(0, 40)}…)`);
    const rp = await page.locator('#wall-avatars img').first().getAttribute('referrerpolicy').catch(() => null);
    ok(rp === 'no-referrer' || (await page.locator('#wall-avatars img').count()) === 0, 'avatar images use referrerpolicy=no-referrer');
    const thr = await page.locator('#wall-threshold').textContent();
    ok(/[\d,]+ sats/.test(thr), `threshold rendered in sats (${thr.trim()})`);
  }

  // --- signed-out custom amount → real LNURL invoice ---
  await page.fill('#zap-amount', '1234');
  await page.fill('#zap-message', 'e2e test — please ignore, not paying');
  await page.click('#zap-submit');
  await page.waitForFunction(
    () => (document.getElementById('invoice-bolt11')?.value || '').startsWith('lnbc'),
    null,
    { timeout: 20000 },
  );
  const bolt11 = await page.inputValue('#invoice-bolt11');
  ok(bolt11.startsWith('lnbc'), `real bolt11 invoice fetched (${bolt11.slice(0, 24)}…)`);
  await page.waitForSelector('#invoice-qr:not(.hidden)', { timeout: 10000 });
  const qrSrc = await page.locator('#invoice-qr').getAttribute('src');
  ok(qrSrc?.startsWith('data:image'), 'QR code rendered');
  const lnHref = await page.locator('#invoice-open').getAttribute('href');
  ok(lnHref === `lightning:${bolt11}`, 'lightning: deep link matches the invoice');

  // --- WebLN (stubbed) button appears and receives the invoice ---
  ok(await page.locator('#invoice-webln').isVisible(), 'Pay with WebLN button shown when window.webln exists');
  await page.click('#invoice-webln');
  await page.waitForSelector('#invoice-paid:not(.hidden)', { timeout: 10000 });
  const paidWith = await page.evaluate(() => window.__weblnPaid);
  ok(paidWith.length === 1 && paidWith[0] === bolt11, 'WebLN stub received exactly the displayed bolt11');

  // --- repeat invoice: onclick handlers must not stack stale closures ---
  await page.click('#invoice-back');
  await page.fill('#zap-amount', '2100');
  await page.click('#zap-submit');
  await page.waitForFunction(
    (prev) => {
      const v = document.getElementById('invoice-bolt11')?.value || '';
      return v.startsWith('lnbc') && v !== prev;
    },
    bolt11,
    { timeout: 20000 },
  );
  const bolt11b = await page.inputValue('#invoice-bolt11');
  await page.click('#invoice-webln');
  await page.waitForFunction(() => window.__weblnPaid.length >= 2, null, { timeout: 10000 });
  const paid2 = await page.evaluate(() => window.__weblnPaid);
  ok(
    paid2.length === 2 && paid2[1] === bolt11b && bolt11b !== bolt11,
    'second invoice pays the NEW bolt11 exactly once (no stale stacked handlers)',
  );

  // --- absurdly large amount: rejected before any URL is built ---
  await page.click('#invoice-back');
  await page.fill('#zap-amount', '99999999999999999999'); // > MAX_SAFE_INTEGER/1000 sats
  await page.click('#zap-submit');
  await page.waitForSelector('#zap-error:not(.hidden)', { timeout: 5000 });
  ok(
    /valid amount/i.test(await page.locator('#zap-error').textContent()),
    'unsafe-integer sats amount shows the validation error (no scientific-notation LNURL amount)',
  );
} catch (err) {
  failed = true;
  console.error('❌ test run crashed:', err);
} finally {
  await browser.close();
}

console.log(failed ? '\n❌ zap e2e FAILED' : '\n✅ zap e2e passed');
process.exit(failed ? 1 : 0);
