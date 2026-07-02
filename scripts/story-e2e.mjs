// scripts/story-e2e.mjs — self-cleaning E2E for /story.
// Publishes 2 test notes from a throwaway "project" key + a reply from a second
// throwaway key, drives the page with Playwright, then NIP-09-deletes ALL test
// events (so nothing persists on the public relays).
//
// Run from the repo root (after `npm run build`; needs Playwright chromium):
//   node scripts/story-e2e.mjs
import { spawn } from 'node:child_process';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
];
const PORT = 4324;
const BASE = `http://localhost:${PORT}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const bytesToHex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');

// ---- relay helpers (Node) ----
function publishEvent(signed, { minOks = 1, timeout = 6000 } = {}) {
  return new Promise((resolve) => {
    let oks = 0;
    let settled = false;
    const sockets = [];
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      for (const ws of sockets) { try { ws.close(); } catch {} }
      resolve(oks);
    };
    const t = setTimeout(done, timeout);
    for (const url of RELAYS) {
      let ws;
      try { ws = new WebSocket(url); } catch { continue; }
      sockets.push(ws);
      ws.on('open', () => ws.send(JSON.stringify(['EVENT', signed])));
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m[0] === 'OK' && m[1] === signed.id && m[2]) { oks++; if (oks >= minOks) setTimeout(done, 500); }
        } catch {}
      });
      ws.on('error', () => {});
    }
  });
}

function queryRelays(filter, { timeout = 6000 } = {}) {
  return new Promise((resolve) => {
    const events = new Map();
    let pending = RELAYS.length;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve([...events.values()]);
    };
    const t = setTimeout(done, timeout);
    const oneDone = () => { if (--pending <= 0) done(); };
    for (const url of RELAYS) {
      let ws;
      try { ws = new WebSocket(url); } catch { oneDone(); continue; }
      const sub = Math.random().toString(36).slice(2, 10);
      ws.on('open', () => ws.send(JSON.stringify(['REQ', sub, filter])));
      ws.on('message', (d) => {
        try {
          const m = JSON.parse(d.toString());
          if (m[0] === 'EVENT' && m[1] === sub) events.set(m[2].id, m[2]);
          if (m[0] === 'EOSE' && m[1] === sub) { try { ws.close(); } catch {} oneDone(); }
        } catch {}
      });
      ws.on('error', () => oneDone());
    }
  });
}

// ---- throwaway keys ----
const skP = generateSecretKey(); // throwaway "project" account
const pkP = getPublicKey(skP);
const npubP = nip19.npubEncode(pkP);
const skR = generateSecretKey(); // throwaway replier
const pkR = getPublicKey(skR);

const now = Math.floor(Date.now() / 1000);
const sign = (sk, tpl) => finalizeEvent(tpl, sk);
const published = []; // [{ sk, id, kind }] for cleanup

async function pub(sk, tpl, label) {
  const ev = sign(sk, tpl);
  const oks = await publishEvent(ev);
  published.push({ sk, id: ev.id, kind: ev.kind });
  console.log(`published ${label} (${ev.id.slice(0, 8)}…) → ${oks} relay OKs`);
  return ev;
}

// ---- server ----
async function startPreview() {
  // Spawn astro directly (not via npm) so kill() reaches the real server.
  const proc = spawn('node', ['node_modules/astro/astro.js', 'preview', '--port', String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`${BASE}/story`);
      if (res.ok) return proc;
    } catch {}
  }
  throw new Error('preview server did not start');
}

let preview;
let browser;
try {
  // 1. Seed test data
  await pub(skP, { kind: 0, created_at: now - 300, tags: [], content: JSON.stringify({ name: 'LP Story E2E', about: 'Throwaway Lightning Piggy story E2E account — events are NIP-09 deleted after the test.', picture: '' }) }, 'project profile');
  await pub(skR, { kind: 0, created_at: now - 300, tags: [], content: JSON.stringify({ name: 'LP Test Replier', about: 'Throwaway E2E replier' }) }, 'replier profile');
  const note1 = await pub(skP, { kind: 1, created_at: now - 120, tags: [], content: 'LP story E2E test note ONE (older) — please ignore, will be deleted. https://lightningpiggy.com' }, 'note ONE');
  const note2 = await pub(skP, { kind: 1, created_at: now, tags: [], content: 'LP story E2E test note TWO (newer) — please ignore, will be deleted.' }, 'note TWO');

  // 2. Server + browser
  preview = await startPreview();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  // Point the page's author constant at the throwaway "project" key via its
  // data attribute (set the moment the element exists, before module scripts run).
  await ctx.addInitScript(({ npub, session }) => {
    localStorage.setItem('lp_nostr_session', JSON.stringify(session));
    const obs = new MutationObserver(() => {
      const el = document.getElementById('story-feed');
      if (el) { el.dataset.authorNpub = npub; obs.disconnect(); }
    });
    // documentElement doesn't exist yet at init-script time; document does.
    obs.observe(document, { childList: true, subtree: true });
  }, { npub: npubP, session: { pubkey: pkR, method: 'nsec', sk: bytesToHex(skR), name: 'LP Test Replier' } });

  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded' });

  // 3. Feed renders both notes, newest first
  await page.waitForSelector('.story-note', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.story-note').length >= 2, null, { timeout: 30000 });
  const texts = await page.$$eval('.story-note article p', (els) => els.map((e) => e.textContent || ''));
  const cards = await page.$$('.story-note');
  const first = await cards[0].textContent();
  const second = await cards[1].textContent();
  check('feed renders both test notes', texts.join(' ').includes('note ONE') && texts.join(' ').includes('note TWO'));
  check('newest-first ordering', first.includes('note TWO') && second.includes('note ONE'));

  // 4. Reply to note TWO (the first card) via the signed-in composer
  const noteTwoCard = page.locator(`.story-note[data-note-id="${note2.id}"]`);
  await noteTwoCard.locator('.reply-toggle').click();
  const replyText = `LP E2E reply ${Date.now()} — will be deleted`;
  await noteTwoCard.locator('.reply-text').fill(replyText);
  await noteTwoCard.locator('.reply-form button[type=submit]').click();
  await noteTwoCard.locator('.story-reply', { hasText: replyText.slice(0, 20) }).waitFor({ timeout: 20000 });
  const replyAuthor = await noteTwoCard.locator('.story-reply .reply-author').first().textContent();
  check('reply appears under the right note', true);
  check('reply shows author name', (replyAuthor || '').includes('LP Test Replier'), `author="${replyAuthor}"`);
  const strayReply = await page.locator(`.story-note[data-note-id="${note1.id}"] .story-reply`).count();
  check('reply NOT under the other note', strayReply === 0);

  // Demo screenshots (test data): populated feed + expanded reply thread.
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/PR-story/story-feed-demo-raw.png', fullPage: true });

  // 5. Delete own reply via the trash icon (NIP-09)
  await noteTwoCard.locator('.reply-delete').first().click();
  await noteTwoCard.locator('.story-reply').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  const remaining = await noteTwoCard.locator('.story-reply').count();
  check('own-reply trash deletes it', remaining === 0);
  await ctx.close();

  // 6. Screenshots with the REAL project npub (no override, signed out)
  const shotCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  const shotPage = await shotCtx.newPage();
  await shotPage.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded' });
  await shotPage.waitForFunction(
    () => document.querySelectorAll('.story-note').length > 0 || !document.getElementById('story-empty')?.classList.contains('hidden'),
    null, { timeout: 30000 },
  );
  const realNotes = await shotPage.locator('.story-note').count();
  check('real project feed loads', true, `${realNotes} notes from the real npub`);
  await shotPage.waitForTimeout(6000); // let images/replies settle
  await shotPage.screenshot({ path: 'docs/screenshots/PR-story/story-page-raw.png', fullPage: false });
  if (realNotes > 0) {
    await shotPage.locator('.story-note .reply-toggle').first().click();
    await shotPage.waitForTimeout(1500);
    await shotPage.locator('.story-note').first().scrollIntoViewIfNeeded();
    await shotPage.screenshot({ path: 'docs/screenshots/PR-story/story-replies-raw.png', fullPage: false });
  }
  await shotCtx.close();
} catch (err) {
  console.error('E2E error:', err);
  check('E2E completed without errors', false, String(err));
} finally {
  try { await browser?.close(); } catch {}
  try { preview?.kill(); } catch {}

  // 7. Cleanup: NIP-09-delete ALL test events (incl. any strays found on relays)
  console.log('\nCleaning up test events…');
  for (const [sk, pk] of [[skP, pkP], [skR, pkR]]) {
    const strays = await queryRelays({ kinds: [0, 1], authors: [pk] });
    for (const ev of strays) if (!published.some((p) => p.id === ev.id)) published.push({ sk, id: ev.id, kind: ev.kind });
  }
  for (const { sk, id, kind } of published) {
    const del = sign(sk, { kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', id], ['k', String(kind)]], content: 'E2E cleanup' });
    const oks = await publishEvent(del);
    console.log(`deleted ${id.slice(0, 8)}… (kind ${kind}) → ${oks} relay OKs`);
  }
  const left = await queryRelays({ kinds: [1], authors: [pkP, pkR] });
  console.log(`post-cleanup: ${left.length} kind-1 events still returned by relays (deletion propagation may lag)`);

  console.log('\n==== RESULTS ====');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
