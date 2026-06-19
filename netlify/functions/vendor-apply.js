// Netlify function (V2): receives a "become a vendor" application from the
// market page, runs it through spam safeguards, stores it as a pending
// submission in Netlify Blobs (store: "vendor-submissions"), and notifies the
// team (plus a confirmation to the applicant) via Resend.
//
// NOTE: this is a V2 function (default export). V2 is required so Netlify Blobs
// auto-configures — legacy V1 (exports.handler) functions do not.
//
// The admin tool reads these pending submissions via the companion
// `vendor-submissions` function and imports approved ones as vendors.
//
// Environment variables (set in Netlify):
//   RESEND_API_KEY     — API key from resend.com (shared with other functions)

import { getStore } from '@netlify/blobs';

const NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
const FROM_EMAIL = 'Lightning Piggy <newsletter@mail.lightningpiggy.com>';
const STORE_NAME = 'vendor-submissions';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
const NPUB_REGEX = /^npub1[a-z0-9]{20,}$/i;
const SHOP_TYPES = ['online', 'physical', 'both'];
const VALID_REGIONS = ['Europe', 'North America', 'South America', 'Asia', 'Africa', 'Oceania', 'Worldwide'];

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientIp(req, context) {
  if (context && context.ip) return context.ip;
  const h = req.headers;
  return (h.get('x-nf-client-connection-ip') || h.get('x-forwarded-for') || h.get('client-ip') || '')
    .split(',')[0].trim();
}

// Silent-success — never tell bots they were caught; log for monitoring.
function silentSuccess(ip, reason, detail) {
  console.log('[spam] ' + reason + (detail ? ' — ' + detail : '') + ' from ' + (ip || 'unknown'));
  return jsonResponse(200, { success: true });
}

// In-memory rate limiter (resets on cold start — acceptable, still slows bursts).
const _rateBuckets = new Map();
function rateLimitHit(ip, maxPerMinute, maxPerHour) {
  if (!ip) return false;
  const now = Date.now();
  const bucket = _rateBuckets.get(ip) || { minute: [], hour: [] };
  bucket.minute = bucket.minute.filter((t) => now - t < 60 * 1000);
  bucket.hour = bucket.hour.filter((t) => now - t < 60 * 60 * 1000);
  if (bucket.minute.length >= maxPerMinute) return true;
  if (bucket.hour.length >= maxPerHour) return true;
  bucket.minute.push(now);
  bucket.hour.push(now);
  _rateBuckets.set(ip, bucket);
  if (_rateBuckets.size > 1000) {
    for (const entry of _rateBuckets) {
      if (entry[1].hour.length === 0) _rateBuckets.delete(entry[0]);
    }
  }
  return false;
}

async function fetchWithRetry(url, options, maxRetries = 3) {
  let delay = 600;
  let res;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetch(url, options);
    if (res.status !== 429 || attempt === maxRetries) return res;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  return res;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 500);
}

async function sendEmail(apiKey, payload) {
  const res = await fetchWithRetry('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch (e) {}
    console.error('Resend send failed: ' + res.status + ' ' + detail);
  }
  return res.ok;
}

function ownerEmailHtml(v) {
  const rows = [
    ['Store name', v.name],
    ['Contact email', v.contactEmail],
    ['Country', v.country],
    ['Shop type', v.shopType],
    ['Shipping regions', (v.shippingRegions || []).join(', ') || '—'],
    ['Website', v.websiteUrl],
    ['Nostr npub', v.nostrNpub || '—'],
    ['X profile', v.xProfileUrl || '—'],
    ['Description', v.description],
  ].map((r) =>
    '<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;color:#444;">' + escapeHtml(r[0]) +
    '</td><td style="padding:6px 12px;color:#111;">' + escapeHtml(r[1]) + '</td></tr>'
  ).join('');
  return '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">' +
    '<h2 style="margin:0 0 4px;">New vendor application 🐷</h2>' +
    '<p style="color:#666;margin:0 0 16px;">Submission ID: ' + escapeHtml(v.id) + ' · ' + escapeHtml(v.submittedAt) + '</p>' +
    '<table style="border-collapse:collapse;border:1px solid #eee;">' + rows + '</table>' +
    '<p style="color:#666;margin-top:16px;">Open the admin tool → Vendors → Pending Applications to review and import.</p>' +
    '</div>';
}

function applicantEmailHtml(v) {
  return '<div style="font-family:Inter,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">' +
    '<p>Hi' + (v.name ? ' from ' + escapeHtml(v.name) : '') + ',</p>' +
    '<p>Thanks for applying to stock Lightning Piggy in our market! 🐷⚡</p>' +
    '<p>We\'ve received your application and the team will review it shortly. ' +
    'If it\'s a good fit, we\'ll be in touch at this email address.</p>' +
    '<p>— Team Lightning Piggy</p>' +
    '</div>';
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const ip = clientIp(req, context);

  // --- Spam-prevention layers ---

  // Layer 1: Honeypot field — bots fill this, humans don't see it.
  if (body.website && String(body.website).trim()) {
    return silentSuccess(ip, 'honeypot');
  }

  // Layer 2: Time-to-fill check — this form takes humans well over 4s to fill.
  if (typeof body.startedAt === 'number') {
    const elapsed = Date.now() - body.startedAt;
    if (elapsed >= 0 && elapsed < 4000) {
      return silentSuccess(ip, 'too-fast', elapsed + 'ms');
    }
  }

  // Layer 3: Rate limit per IP (2/min burst, 6/hr sustained).
  if (rateLimitHit(ip, 2, 6)) {
    return silentSuccess(ip, 'rate-limited');
  }

  // --- Validation (real errors — these get shown to the user) ---
  const name = str(body.name, 120);
  const contactEmail = str(body.contactEmail, 320).toLowerCase();
  const country = str(body.country, 80);
  const description = str(body.description, 600);
  const websiteUrl = str(body.websiteUrl, 300);
  const shopType = SHOP_TYPES.indexOf(body.shopType) !== -1 ? body.shopType : 'online';
  const nostrNpub = str(body.nostrNpub, 80);
  const xProfileUrl = str(body.xProfileUrl, 300);
  const shippingRegions = Array.isArray(body.shippingRegions)
    ? body.shippingRegions.filter((r) => VALID_REGIONS.indexOf(r) !== -1).slice(0, VALID_REGIONS.length)
    : [];

  const bad = (msg) => jsonResponse(400, { error: msg });

  if (!name) return bad('Store name is required.');
  if (!contactEmail || !EMAIL_REGEX.test(contactEmail)) return bad('A valid contact email is required.');
  if (!country) return bad('Country is required.');
  if (!description) return bad('Please add a short description.');
  if (!websiteUrl || !URL_REGEX.test(websiteUrl)) return bad('A valid website URL (https://…) is required.');
  if (nostrNpub && !NPUB_REGEX.test(nostrNpub)) return bad('Nostr npub looks invalid (should start with npub1…).');
  if (xProfileUrl && !URL_REGEX.test(xProfileUrl)) return bad('X profile URL looks invalid.');
  if (!nostrNpub && !xProfileUrl) return bad('Please add a Nostr npub or X profile URL — your store logo is downloaded from one of these.');

  // Layer 4: link-spam heuristic — reject obvious link dumps in the description.
  const urlCount = (description.match(/https?:\/\//gi) || []).length;
  if (urlCount >= 3) {
    return silentSuccess(ip, 'link-spam', urlCount + ' urls');
  }

  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

  const submission = {
    id,
    status: 'pending',
    submittedAt: new Date().toISOString(),
    ip: ip || '',
    name,
    contactEmail,
    country,
    shopType,
    shippingRegions,
    description,
    websiteUrl,
    nostrNpub,
    xProfileUrl,
  };

  // --- Store as a pending submission (Netlify Blobs) ---
  try {
    const store = getStore(STORE_NAME);
    await store.setJSON(id, submission);
  } catch (err) {
    console.error('Blob store write failed:', err && err.message);
    return jsonResponse(502, { error: 'Could not save your application. Please try again.' });
  }

  // --- Notify team + acknowledge applicant (best-effort; don't fail the request) ---
  if (apiKey) {
    try {
      await sendEmail(apiKey, {
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        reply_to: contactEmail,
        subject: 'New vendor application: ' + name,
        html: ownerEmailHtml(submission),
      });
      await new Promise((r) => setTimeout(r, 600)); // stay under Resend 2 req/s
      await sendEmail(apiKey, {
        from: FROM_EMAIL,
        to: contactEmail,
        subject: 'We received your Lightning Piggy vendor application',
        html: applicantEmailHtml(submission),
      });
    } catch (err) {
      console.error('Email notification failed:', err && err.message);
    }
  } else {
    console.warn('RESEND_API_KEY not set — submission stored but no emails sent.');
  }

  return jsonResponse(200, { success: true, id });
};
