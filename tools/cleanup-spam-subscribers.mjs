#!/usr/bin/env node
// Find and delete spam subscribers from the Resend audience.
// Currently targets Gmail dot-trick variants (3+ dots in local part).
//
// Usage:
//   RESEND_API_KEY=re_xxxxx node tools/cleanup-spam-subscribers.mjs           # dry-run, lists matches
//   RESEND_API_KEY=re_xxxxx node tools/cleanup-spam-subscribers.mjs --delete  # actually deletes
//
// The audience ID is read from `netlify env:get` automatically, so you only
// need to provide the API key (which Netlify masks).

import { execSync } from 'node:child_process';

const API_KEY = process.env.RESEND_API_KEY;
const DELETE = process.argv.includes('--delete');

if (!API_KEY) {
  console.error('Usage: RESEND_API_KEY=re_xxxxx node tools/cleanup-spam-subscribers.mjs [--delete]');
  process.exit(1);
}

// Pull audience ID from Netlify (it's not a secret, just an ID)
let AUDIENCE_ID;
try {
  const json = execSync('netlify env:get RESEND_NEWSLETTER_SEGMENT_ID --context production --json', { encoding: 'utf8' });
  AUDIENCE_ID = JSON.parse(json).RESEND_NEWSLETTER_SEGMENT_ID;
} catch (e) {
  console.error('Could not read audience ID from netlify CLI. Run `netlify link` first or pass via RESEND_AUDIENCE_ID env var.');
  AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;
}

if (!AUDIENCE_ID) {
  console.error('Audience ID is required.');
  process.exit(1);
}

function localPartDotCount(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return 0;
  return (email.slice(0, at).match(/\./g) || []).length;
}

function isDotTrick(email) {
  const lower = email.toLowerCase();
  const isGmail = lower.endsWith('@gmail.com') || lower.endsWith('@googlemail.com');
  return isGmail && localPartDotCount(lower) >= 3;
}

async function listAllContacts() {
  const all = [];
  let resp = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!resp.ok) {
    console.error(`Failed to list contacts: ${resp.status} ${await resp.text()}`);
    process.exit(1);
  }
  const data = await resp.json();
  all.push(...(data.data || []));
  return all;
}

async function deleteContact(id, email) {
  const resp = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!resp.ok) {
    console.error(`  ✗ Failed to delete ${email}: ${resp.status} ${await resp.text()}`);
    return false;
  }
  return true;
}

(async () => {
  console.log(`${DELETE ? '🗑️  DELETE MODE' : '🔍 DRY-RUN MODE'} (use --delete to actually remove)`);
  console.log(`Audience: ${AUDIENCE_ID}`);
  console.log('Fetching contacts...');
  const contacts = await listAllContacts();
  console.log(`Found ${contacts.length} total contacts.`);

  const spam = contacts.filter(c => isDotTrick(c.email));
  console.log(`Found ${spam.length} dot-trick spam contacts:\n`);

  for (const c of spam) {
    console.log(`  - ${c.email} (id: ${c.id})`);
  }

  if (!DELETE) {
    console.log('\nDry-run complete. Re-run with --delete to remove these contacts.');
    return;
  }

  if (spam.length === 0) return;

  console.log('\nDeleting...');
  let deleted = 0;
  for (const c of spam) {
    const ok = await deleteContact(c.id, c.email);
    if (ok) {
      console.log(`  ✓ Deleted ${c.email}`);
      deleted++;
    }
    await new Promise(r => setTimeout(r, 600)); // stay under Resend's 2/s rate limit
  }
  console.log(`\nDone. Deleted ${deleted}/${spam.length} contacts.`);
})();
