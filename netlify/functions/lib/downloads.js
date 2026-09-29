// Shared helpers for the buy-to-support download flow (CommonJS, see package.json).
const fs = require('fs');
const path = require('path');

const SITE = 'https://lightningpiggy.com';
const BTCPAY_URL = 'https://btcpay.lightningpiggy.com';

// Bundled with the functions via netlify.toml included_files. The runtime
// places included files at their repo-relative path under the task root, but
// try a couple of bases so a layout change fails loudly rather than 404s.
function privateDir() {
  const rel = path.join('private', 'downloads', 'cases');
  const roots = new Set([process.cwd(), process.env.LAMBDA_TASK_ROOT || '', '/var/task']);
  // Walk up from this file: functions/lib -> functions -> task root -> ...
  let d = __dirname;
  for (let i = 0; i < 5; i++) { roots.add(d); d = path.dirname(d); }
  const candidates = [];
  for (const r of roots) if (r) candidates.push(path.join(r, 'netlify', rel), path.join(r, rel));
  for (const c of candidates) if (fs.existsSync(c)) return c;
  let listing = '';
  try { listing = ' task root contains: ' + fs.readdirSync(process.env.LAMBDA_TASK_ROOT || '/var/task').join(', '); } catch {}
  throw new Error('private downloads directory not found (tried ' + candidates.join(', ') + ')' + listing);
}

// Formats that can be sold, and the Content-Type each is served with.
const FORMATS = { '3mf': 'model/3mf', stl: 'model/stl', step: 'model/step', stp: 'model/step' };
const FILE_ID_RE = /^[a-z0-9][a-z0-9._-]{0,80}\.(3mf|stl|step|stp)$/i;
const extOf = (id) => String(id).split('.').pop().toLowerCase();
const contentTypeFor = (id) => FORMATS[extOf(id)] || 'application/octet-stream';

// Only a bare basename in an allowed format that actually exists is a valid file id.
function resolveFile(id) {
  if (typeof id !== 'string' || !FILE_ID_RE.test(id) || id.includes('..')) return null;
  const full = path.join(privateDir(), id);
  return fs.existsSync(full) ? full : null;
}

function corsHeaders(event) {
  const origin = ((event && event.headers) || {}).origin || '';
  const allowed = (origin === SITE || origin.endsWith('.netlify.app')) ? origin : SITE;
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}

async function getInvoice(invoiceId) {
  const res = await fetch(`${BTCPAY_URL}/api/v1/stores/${process.env.BTCPAY_STORE_ID}/invoices/${encodeURIComponent(invoiceId)}`, {
    headers: { Authorization: `token ${process.env.BTCPAY_API_KEY}` },
  });
  if (!res.ok) return null;
  return res.json();
}

const PRICING = require('./download-pricing.json');
// Minimum support amount for a file: its own entry if set, else the default.
function minimumFor(fileId) {
  const own = PRICING.minimums && PRICING.minimums[fileId];
  return Number(own || PRICING.default || 3);
}

module.exports = { SITE, BTCPAY_URL, privateDir, resolveFile, corsHeaders, getInvoice, minimumFor, contentTypeFor, extOf, FILE_ID_RE, MAX_USD: Number(PRICING.maximum || 500) };
