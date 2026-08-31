// Netlify serverless function: first half of the double opt-in newsletter
// signup. Validates the address (honeypot, fill-time, rate limit, dot-trick),
// then emails a signed confirmation link. Nothing is added to the audience
// here - newsletter-confirm does that when the link is clicked, so bots that
// never open the mailbox never enter the list.
//
// Environment variables required in Netlify:
//   RESEND_API_KEY            — API key from resend.com (shared with webhook functions)
//   NEWSLETTER_CONFIRM_SECRET — HMAC secret shared with newsletter-confirm

var crypto = require('crypto');

var ALLOWED_ORIGIN = 'https://lightningpiggy.com';

// Signed confirmation token: base64url(email).timestamp.hmac - verified by
// newsletter-confirm, which enforces a 48h expiry.
function makeToken(email, secret) {
  var e = Buffer.from(email, 'utf8').toString('base64url');
  var payload = e + '.' + Date.now();
  var sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return payload + '.' + sig;
}

function corsHeaders(event) {
  var origin = (event.headers || {}).origin || '';
  var allowed = (origin === ALLOWED_ORIGIN || origin.endsWith('.netlify.app')) ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

var NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
var FROM_EMAIL = 'Lightning Piggy <newsletter@mail.lightningpiggy.com>';

// Excludes HTML metacharacters as well as whitespace/@: the address is echoed
// into the owner-notification email, and the old pattern happily accepted
// something like `a<img src=x onerror=...>b@evil.com`.
var EMAIL_REGEX = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/;

// Defence in depth — the regex above is the gate, this makes the interpolation
// safe regardless. Matches the helper used in the btcpay webhooks.
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Fetch with exponential backoff on 429 rate limits
// Retries up to 3 times with delays of 600ms, 1200ms, 2400ms
async function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  var delay = 600;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var res = await fetch(url, options);
    if (res.status !== 429 || attempt === maxRetries) return res;
    console.log('Rate limited, retrying in ' + delay + 'ms (attempt ' + (attempt + 1) + ')');
    await new Promise(function (r) { setTimeout(r, delay); });
    delay *= 2;
  }
  return res;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// --- Spam-prevention helpers ---

// Silent-success response — never tell bots they were caught.
// Logs server-side so we can monitor rejection patterns.
function silentSuccess(event, reason, detail) {
  console.log('[spam] ' + reason + (detail ? ' — ' + detail : '') + ' from ' + (event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown'));
  return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ success: true }) };
}

// Count dots in the local part of an email (used for Gmail dot-trick detection).
function localPartDotCount(email) {
  var at = email.lastIndexOf('@');
  if (at === -1) return 0;
  return (email.slice(0, at).match(/\./g) || []).length;
}

// Canonicalize an email address. Gmail/Googlemail strip dots and +alias; other
// providers just get lowercased so we don't break legitimate aliasing.
function canonicalEmail(email) {
  var lower = email.trim().toLowerCase();
  var at = lower.lastIndexOf('@');
  if (at === -1) return lower;
  var local = lower.slice(0, at);
  var domain = lower.slice(at + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('+')[0].replace(/\./g, '');
    return local + '@gmail.com'; // normalize googlemail → gmail
  }
  return local + '@' + domain;
}

// In-memory rate limiter. Netlify functions can warm-cache this between
// invocations; on cold starts the map resets (acceptable trade-off — burst
// limit still slows attackers significantly).
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
  // Periodically clean stale buckets to bound memory
  if (_rateBuckets.size > 1000) {
    for (var entry of _rateBuckets) {
      if (entry[1].hour.length === 0) _rateBuckets.delete(entry[0]);
    }
  }
  return false;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  var apiKey = process.env.RESEND_API_KEY;
  var confirmSecret = process.env.NEWSLETTER_CONFIRM_SECRET;

  if (!apiKey || !confirmSecret) {
    console.error('RESEND_API_KEY or NEWSLETTER_CONFIRM_SECRET environment variable is not set');
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  // Parse request body
  var body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  // --- Spam-prevention layers (silent rejection — return 200 success but don't process) ---

  // Layer 1: Honeypot field — bots fill this, humans don't see it.
  if (body.website && String(body.website).trim()) {
    return silentSuccess(event, 'honeypot');
  }

  // Layer 2: Time-to-fill check — humans take >3s to read+fill+click.
  if (typeof body.startedAt === 'number') {
    var elapsed = Date.now() - body.startedAt;
    if (elapsed >= 0 && elapsed < 3000) {
      return silentSuccess(event, 'too-fast', elapsed + 'ms');
    }
  }

  // Layer 3: Rate limit per IP (1/min burst, 5/hr sustained).
  var ip = (event.headers['x-forwarded-for'] || event.headers['client-ip'] || '').split(',')[0].trim();
  if (rateLimitHit(ip, 1, 5)) {
    return silentSuccess(event, 'rate-limited');
  }

  var email = (body.email || '').trim().toLowerCase();

  if (!email) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Email is required.' }) };
  }

  if (email.length > 320) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Email address is too long.' }) };
  }

  if (!EMAIL_REGEX.test(email)) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  // Layer 4: Gmail dot-trick filter — 3+ dots in Gmail local part is essentially always spam.
  var isGmail = email.endsWith('@gmail.com') || email.endsWith('@googlemail.com');
  if (isGmail && localPartDotCount(email) >= 3) {
    return silentSuccess(event, 'gmail-dot-trick', email);
  }

  // Layer 5: Canonicalize — dedupes Gmail dot-trick variants in the audience.
  var canonical = canonicalEmail(email);

  // Send the confirmation email. The contact is only added to the audience
  // when the link inside it is clicked (newsletter-confirm).
  var token = makeToken(canonical, confirmSecret);
  var confirmUrl = ALLOWED_ORIGIN + '/.netlify/functions/newsletter-confirm?token=' + encodeURIComponent(token);

  var html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>',
    '<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f5f5;"><tr><td align="center" style="padding:24px 16px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;">',
    '  <tr><td align="center" style="padding:0 0 24px 0;">',
    '    <a href="https://lightningpiggy.com" style="text-decoration:none;"><img src="https://lightningpiggy.com/images/email/lightningpiggy-logo.png" alt="Lightning Piggy" width="200" style="display:block;width:200px;max-width:200px;height:auto;"></a>',
    '  </td></tr>',
    '  <tr><td>',
    '    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#ffffff;border-radius:16px;overflow:hidden;">',
    '      <tr><td style="background-color:#EC008C;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '      <tr><td style="padding:40px 40px 24px 40px;">',
    '        <h1 style="margin:0;font-size:28px;font-weight:700;line-height:34px;color:#111827;">One more oink to go 🐽</h1>',
    '      </td></tr>',
    '      <tr><td style="padding:0 40px 8px 40px;font-size:16px;line-height:26px;color:#525252;">',
    '        <p style="margin:0 0 16px 0;">Someone - hopefully you - asked to subscribe this address to <strong>Freedom Farm News</strong>, the Lightning Piggy newsletter.</p>',
    '        <p style="margin:0 0 16px 0;">Confirm below and you\'re in. If this wasn\'t you, just ignore this email - the address won\'t be subscribed and you won\'t hear from us again.</p>',
    '      </td></tr>',
    '      <tr><td style="padding:8px 40px 40px 40px;" align="center">',
    '        <table role="presentation" cellpadding="0" cellspacing="0"><tr>',
    '          <td style="background-color:#EC008C;border-radius:50px;">',
    '            <a href="' + confirmUrl + '" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;">Confirm my subscription</a>',
    '          </td>',
    '        </tr></table>',
    '        <p style="margin:16px 0 0 0;font-size:12px;line-height:18px;color:#9ca3af;">This link works for 48 hours.</p>',
    '      </td></tr>',
    '    </table>',
    '  </td></tr>',
    '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join('\n');

  try {
    var res = await fetchWithRetry('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [canonical],
        subject: 'Confirm your Freedom Farm News subscription',
        html: html
      })
    });

    if (res.ok) {
      return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ success: true, confirm: true }) };
    }

    var status = res.status;
    var errBody;
    try { errBody = await res.json(); } catch (e) { errBody = {}; }
    if (status === 429) {
      return { statusCode: 429, headers: corsHeaders(event), body: JSON.stringify({ error: 'Too many requests. Please try again in a moment.' }) };
    }
    if (status === 422) {
      return { statusCode: 422, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid email address.' }) };
    }
    console.error('Resend API error:', status, JSON.stringify(errBody));
    return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'Subscription failed. Please try again.' }) };
  } catch (err) {
    console.error('Resend API fetch error:', err.message);
    return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'Subscription failed. Please try again.' }) };
  }
};
