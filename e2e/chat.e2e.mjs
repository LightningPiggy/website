// Self-cleaning end-to-end test for the site-wide Nostr chat (NostrChat.astro).
//
// Uses TWO fresh throwaway keys — a "visitor" (signs in via the login dialog
// with an nsec) and a fake "team" recipient — so the real project npub is
// never messaged. The panel is retargeted at the test recipient via the
// component's `data-recipient` attribute.
//
// Flow:
//   1. envelope icon visible in the header; clicking it opens the panel
//   2. visitor signs in (nsec) and sends a message from the panel
//   3. node-side: the message is fetched from the real relays as the recipient
//      (kind-1059 wrap → kind-13 seal → kind-14 rumor, NIP-44) and asserted
//   4. node-side: a gift-wrapped reply is sent to the visitor and must appear
//      in the panel (which polls every 15s)
//
// Cleanup: everything published is a NIP-44-encrypted gift wrap between two
// throwaway keys signed by ephemeral keys — nothing references a real identity
// and nothing is readable by anyone else, so no NIP-09 deletion is needed
// (wraps are signed by discarded ephemeral keys and couldn't be deleted anyway).
//
// Prerequisites:
//   1. Build + serve:            npm run build && npm run preview -- --port 4323
//   2. Install the browser once: npx playwright install chromium
// Run:  node e2e/chat.e2e.mjs

import { chromium } from 'playwright';
import { generateSecretKey, getPublicKey, finalizeEvent, getEventHash } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);

const BASE = process.env.BASE_URL || 'http://localhost:4323';
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];

const pool = new SimplePool();
const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fresh throwaway identities per run.
const visitorSk = generateSecretKey();
const visitorPub = getPublicKey(visitorSk);
const visitorNsec = nsecEncode(visitorSk);
const teamSk = generateSecretKey();
const teamPub = getPublicKey(teamSk);

const nonce = Math.random().toString(36).slice(2, 8);
const OUT_MSG = `e2e chat ${nonce}: hello from the website`;
const REPLY_MSG = `e2e reply ${nonce}: hello from the team`;

let failed = false;
const ok = (cond, msg) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  if (!cond) failed = true;
};

// ---- NIP-17 gift wrap helpers (node side) ----
const randPast = () => nowSec() - Math.floor(Math.random() * 172800);

function giftWrap14(senderSk, recipientPub, text) {
  const senderPub = getPublicKey(senderSk);
  const rumor = { kind: 14, pubkey: senderPub, created_at: nowSec(), tags: [['p', recipientPub]], content: text };
  rumor.id = getEventHash(rumor);
  const seal = finalizeEvent(
    {
      kind: 13,
      created_at: randPast(),
      tags: [],
      content: nip44.encrypt(JSON.stringify(rumor), nip44.getConversationKey(senderSk, recipientPub)),
    },
    senderSk,
  );
  const ephSk = generateSecretKey();
  return finalizeEvent(
    {
      kind: 1059,
      created_at: randPast(),
      tags: [['p', recipientPub]],
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephSk, recipientPub)),
    },
    ephSk,
  );
}

function unwrap(wrap, recipientSk) {
  try {
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(recipientSk, wrap.pubkey)));
    if (seal.kind !== 13) return null;
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(recipientSk, seal.pubkey)));
    return rumor.pubkey === seal.pubkey ? rumor : null;
  } catch {
    return null;
  }
}

// Poll the relays until a kind-14 rumor with `text` arrives for `recipient`.
async function awaitDM(recipientPub, recipientSk, text, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const wraps = await pool
      .querySync(RELAYS, { kinds: [1059], '#p': [recipientPub], since: nowSec() - 172800 - 600 }, { maxWait: 6000 })
      .catch(() => []);
    for (const w of wraps) {
      const rumor = unwrap(w, recipientSk);
      if (rumor && rumor.kind === 14 && rumor.content === text) return rumor;
    }
    await sleep(3000);
  }
  return null;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

    // 1. Envelope icon in the header; panel slides open.
    ok(await page.locator('#hdr-chat').isVisible(), 'header envelope icon is visible');
    // Retarget the panel at the throwaway team key (never DM the real npub in tests).
    await page.evaluate((hex) => {
      document.getElementById('nostr-chat').dataset.recipient = hex;
    }, teamPub);
    await page.locator('#hdr-chat').click();
    // A transform-translated panel always has a box, so Playwright's "visible"
    // is meaningless here — wait for the real open signal instead: the
    // translate-x-full class being removed by the open handler.
    await page.waitForFunction(
      () => !document.getElementById('nostr-chat-panel').classList.contains('translate-x-full'),
      undefined,
      { timeout: 10000 },
    );
    await sleep(600); // let the 300ms slide-in transition finish
    ok(
      await page.evaluate(() => {
        const p = document.getElementById('nostr-chat-panel');
        return !p.classList.contains('translate-x-full') && p.getBoundingClientRect().right <= window.innerWidth + 1;
      }),
      'chat panel slides open',
    );
    ok(await page.locator('#nc-signin').isVisible(), 'signed-out view prompts to sign in');

    // 2. Sign in with the visitor's throwaway nsec via the login dialog.
    await page.locator('#nc-signin').click();
    await page.locator('#nostr-login-modal').waitFor({ state: 'visible' });
    await page.locator('#nlm-tab-key').click();
    await page.locator('#nlm-nsec').fill(visitorNsec);
    await page.locator('#nlm-key-btn').click();
    await page.locator('#nc-text').waitFor({ state: 'visible', timeout: 20000 });
    ok(true, 'signed in with nsec — chat composer shown');

    // 3. Send a message from the panel; it must appear as a bubble.
    await page.locator('#nc-text').fill(OUT_MSG);
    await page.locator('#nc-send').click();
    await page.locator('#nc-messages div', { hasText: OUT_MSG }).first().waitFor({ timeout: 15000 });
    ok(true, 'sent message appears in the thread');

    // 4. Node-side: receive + decrypt it as the (test) team from real relays.
    const rumor = await awaitDM(teamPub, teamSk, OUT_MSG);
    ok(!!rumor, 'recipient decrypted the gift-wrapped DM from the relays');
    ok(rumor?.pubkey === visitorPub, 'rumor is authored by the signed-in visitor');

    // 5. Node-side reply → must appear in the panel (polls every 15s).
    const replyWrap = giftWrap14(teamSk, visitorPub, REPLY_MSG);
    await Promise.any(pool.publish(RELAYS, replyWrap)).catch(() => {});
    await page.locator('#nc-messages div', { hasText: REPLY_MSG }).first().waitFor({ timeout: 60000 });
    ok(true, "team's reply appears in the panel via polling");

    // 6. Esc closes the panel.
    await page.keyboard.press('Escape');
    await sleep(500);
    ok(
      await page.evaluate(() => document.getElementById('nostr-chat-panel').classList.contains('translate-x-full')),
      'Esc closes the panel',
    );
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
  // All published events are encrypted wraps between throwaway keys, signed by
  // discarded ephemeral keys — nothing to clean and nothing linkable to anyone.
  pool.close(RELAYS);
  console.log(failed ? '\n=== FAIL ===' : '\n=== PASS (throwaway keys only; nothing to clean) ===');
  process.exit(failed ? 1 : 0);
}
