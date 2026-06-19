// Netlify serverless function: receives a "become a vendor" application from
// the market page, runs it through spam safeguards, stores it as a pending
// submission in Netlify Blobs (store: "vendor-submissions"), and notifies the
// team (plus a confirmation to the applicant) via Resend.
//
// The admin tool reads these pending submissions via the companion
// `vendor-submissions` function and imports approved ones as vendors.
//
// Environment variables (set in Netlify):
//   RESEND_API_KEY     — API key from resend.com (shared with other functions)
//   ADMIN_SYNC_TOKEN   — shared secret; the admin tool uses it to list/import
//                        submissions. Not required here, listed for context.

const { getStore } = require('@netlify/blobs');

var ALLOWED_ORIGIN = 'https://lightningpiggy.com';
var NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
var FROM_EMAIL = 'Lightning Piggy <newsletter@mail.lightningpiggy.com>';
var STORE_NAME = 'vendor-submissions';

var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var URL_REGEX = /^https?:\/\/[^\s.]+\.[^\s]+$/i;
var NPUB_REGEX = /^npub1[a-z0-9]{20,}$/i;
var SHOP_TYPES = ['online', 'physical', 'both'];
var VALID_REGIONS = ['Europe', 'North America', 'South America', 'Asia', 'Africa', 'Oceania', 'Worldwide'];

function corsHeaders(event) {
  var origin = (event.headers || {}).origin || '';
  var allowed = (origin === ALLOWED_ORIGIN || origin.endsWith('.netlify.app')) ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function clientIp(event) {
  return ((event.headers || {})['x-forwarded-for'] || (event.headers || {})['client-ip'] || '').split(',')[0].trim();
}

// Silent-success — never tell bots they were caught; log for monitoring.
function silentSuccess(event, reason, detail) {
  console.log('[spam] ' + reason + (detail ? ' — ' + detail : '') + ' from ' + (clientIp(event) || 'unknown'));
  return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ success: true }) };
}

// In-memory rate limiter (resets on cold start — acceptable, still slows bursts).
var _rateBuckets = new Map();
function rateLimitHit(ip, maxPerMinute, maxPerHour) {
  if (!ip) return false;
  var now = Date.now();
  var bucket = _rateBuckets.get(ip) || { minute: [], hour: [] };
  bucket.minute = bucket.minute.filter(function (t) { return now - t < 60 * 1000; });
  bucket.hour = bucket.hour.filter(function (t) { return now - t < 60 * 60 * 1000; });
  if (bucket.minute.length >= maxPerMinute) return true;
  if (bucket.hour.length >= maxPerHour) return true;
  bucket.minute.push(now);
  bucket.hour.push(now);
  _rateBuckets.set(ip, bucket);
  if (_rateBuckets.size > 1000) {
    for (var entry of _rateBuckets) {
      if (entry[1].hour.length === 0) _rateBuckets.delete(entry[0]);
    }
  }
  return false;
}

function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  var delay = 600;
  return (async function () {
    for (var attempt = 0; attempt <= maxRetries; attempt++) {
      var res = await fetch(url, options);
      if (res.status !== 429 || attempt === maxRetries) return res;
      await new Promise(function (r) { setTimeout(r, delay); });
      delay *= 2;
    }
  })();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max || 500);
}

async function sendEmail(apiKey, payload) {
  var res = await fetchWithRetry('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    var detail = '';
    try { detail = JSON.stringify(await res.json()); } catch (e) {}
    console.error('Resend send failed: ' + res.status + ' ' + detail);
  }
  return res.ok;
}

function ownerEmailHtml(v) {
  var rows = [
    ['Store name', v.name],
    ['Contact email', v.contactEmail],
    ['Country', v.country],
    ['Shop type', v.shopType],
    ['Shipping regions', (v.shippingRegions || []).join(', ') || '—'],
    ['Website', v.websiteUrl],
    ['Nostr npub', v.nostrNpub || '—'],
    ['X profile', v.xProfileUrl || '—'],
    ['Description', v.description]
  ].map(function (r) {
    return '<tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;color:#444;">' + escapeHtml(r[0]) +
      '</td><td style="padding:6px 12px;color:#111;">' + escapeHtml(r[1]) + '</td></tr>';
  }).join('');
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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  var apiKey = process.env.RESEND_API_KEY;

  var body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // --- Spam-prevention layers ---

  // Layer 1: Honeypot field — bots fill this, humans don't see it.
  if (body.website && String(body.website).trim()) {
    return silentSuccess(event, 'honeypot');
  }

  // Layer 2: Time-to-fill check — this form takes humans well over 4s to fill.
  if (typeof body.startedAt === 'number') {
    var elapsed = Date.now() - body.startedAt;
    if (elapsed >= 0 && elapsed < 4000) {
      return silentSuccess(event, 'too-fast', elapsed + 'ms');
    }
  }

  // Layer 3: Rate limit per IP (2/min burst, 6/hr sustained).
  var ip = clientIp(event);
  if (rateLimitHit(ip, 2, 6)) {
    return silentSuccess(event, 'rate-limited');
  }

  // --- Validation (real errors — these get shown to the user) ---
  var name = str(body.name, 120);
  var contactEmail = str(body.contactEmail, 320).toLowerCase();
  var country = str(body.country, 80);
  var description = str(body.description, 600);
  var websiteUrl = str(body.websiteUrl, 300);
  var shopType = SHOP_TYPES.indexOf(body.shopType) !== -1 ? body.shopType : 'online';
  var nostrNpub = str(body.nostrNpub, 80);
  var xProfileUrl = str(body.xProfileUrl, 300);
  var shippingRegions = Array.isArray(body.shippingRegions)
    ? body.shippingRegions.filter(function (r) { return VALID_REGIONS.indexOf(r) !== -1; }).slice(0, VALID_REGIONS.length)
    : [];

  function bad(msg) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: msg }) };
  }

  if (!name) return bad('Store name is required.');
  if (!contactEmail || !EMAIL_REGEX.test(contactEmail)) return bad('A valid contact email is required.');
  if (!country) return bad('Country is required.');
  if (!description) return bad('Please add a short description.');
  if (!websiteUrl || !URL_REGEX.test(websiteUrl)) return bad('A valid website URL (https://…) is required.');
  if (nostrNpub && !NPUB_REGEX.test(nostrNpub)) return bad('Nostr npub looks invalid (should start with npub1…).');
  if (xProfileUrl && !URL_REGEX.test(xProfileUrl)) return bad('X profile URL looks invalid.');
  if (!nostrNpub && !xProfileUrl) return bad('Please add a Nostr npub or X profile URL — your store logo is downloaded from one of these.');

  // Layer 4: link-spam heuristic — reject obvious link dumps in the description.
  var urlCount = (description.match(/https?:\/\//gi) || []).length;
  if (urlCount >= 3) {
    return silentSuccess(event, 'link-spam', urlCount + ' urls');
  }

  var id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

  var submission = {
    id: id,
    status: 'pending',
    submittedAt: new Date().toISOString(),
    ip: ip || '',
    name: name,
    contactEmail: contactEmail,
    country: country,
    shopType: shopType,
    shippingRegions: shippingRegions,
    description: description,
    websiteUrl: websiteUrl,
    nostrNpub: nostrNpub,
    xProfileUrl: xProfileUrl
  };

  // --- Store as a pending submission (Netlify Blobs) ---
  try {
    var store = getStore(STORE_NAME);
    await store.setJSON(id, submission);
  } catch (err) {
    console.error('Blob store write failed:', err && err.message);
    return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'Could not save your application. Please try again.' }) };
  }

  // --- Notify team + acknowledge applicant (best-effort; don't fail the request) ---
  if (apiKey) {
    try {
      await sendEmail(apiKey, {
        from: FROM_EMAIL,
        to: NOTIFICATION_EMAIL,
        reply_to: contactEmail,
        subject: 'New vendor application: ' + name,
        html: ownerEmailHtml(submission)
      });
      await new Promise(function (r) { setTimeout(r, 600); }); // stay under Resend 2 req/s
      await sendEmail(apiKey, {
        from: FROM_EMAIL,
        to: contactEmail,
        subject: 'We received your Lightning Piggy vendor application',
        html: applicantEmailHtml(submission)
      });
    } catch (err) {
      console.error('Email notification failed:', err && err.message);
    }
  } else {
    console.warn('RESEND_API_KEY not set — submission stored but no emails sent.');
  }

  return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ success: true, id: id }) };
};
