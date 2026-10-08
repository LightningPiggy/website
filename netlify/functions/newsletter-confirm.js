// Netlify serverless function: completes a double opt-in newsletter signup.
// The subscribe function emails a signed confirmation link to the
// /newsletter-confirm page, which has a "Confirm" button that POSTs the token
// here. This endpoint verifies the token, adds the contact to the Resend
// audience, and only then sends the welcome email and owner notification - so
// bots that never confirm never enter the list.
//
// Opening a link is not consent: company mail filters (e.g. Microsoft
// Defender Safe Links) open every link in incoming mail to check it. So a GET
// only shows the confirm page (old emails link straight here), and only the
// button's POST subscribes anyone.
//
// Resend accepts a "create contact" for an address it already has, so the
// welcome email and owner notification go out only when the address was not
// on the list before this request (see lib/newsletter-contacts).
//
// Environment variables required in Netlify:
//   RESEND_API_KEY            - API key from resend.com
//   RESEND_AUDIENCE_ID        - audience ID from the Resend dashboard
//   NEWSLETTER_CONFIRM_SECRET - HMAC secret shared with newsletter-subscribe

var crypto = require('crypto');
var newsletterStatus = require('./lib/newsletter-contacts').newsletterStatus;

var SITE = 'https://lightningpiggy.com';
var NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
var FROM_EMAIL = 'Lightning Piggy <newsletter@mail.lightningpiggy.com>';
var TOKEN_MAX_AGE_MS = 48 * 60 * 60 * 1000; // confirmation links last 48 hours

function redirect(status) {
  return {
    statusCode: 303, // after a POST, the browser loads the result page with a GET
    headers: { Location: SITE + '/newsletter-confirmed?status=' + status, 'Cache-Control': 'no-store' },
    body: ''
  };
}

// Who opened or confirmed a link (a person's browser or a mail filter), for
// telling the two apart later. No address or IP is logged.
function logVisit(event, what) {
  var ua = String((event.headers || {})['user-agent'] || 'unknown').slice(0, 200);
  console.log('[newsletter-confirm] ' + what + ' - ' + ua);
}

// The token arrives as a form field (the confirm page's button) or, for links
// in emails sent before the confirm page existed, in the query string.
function tokenFromPost(event) {
  var raw = event.body || '';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  return new URLSearchParams(raw).get('token') || '';
}


// Token format: base64url(email).timestamp.hmac - created by newsletter-subscribe.
function verifyToken(token, secret) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  var email, ts;
  try {
    email = Buffer.from(parts[0], 'base64url').toString('utf8');
    ts = parseInt(parts[1], 10);
  } catch (e) { return null; }
  if (!email || !ts || Date.now() - ts > TOKEN_MAX_AGE_MS || ts > Date.now() + 60000) return null;
  var expected = crypto.createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest('hex');
  var a = Buffer.from(expected); var b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return email;
}

// Fetch with exponential backoff on 429 rate limits
async function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  var delay = 600;
  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    var res = await fetch(url, options);
    if (res.status !== 429 || attempt === maxRetries) return res;
    await new Promise(function (r) { setTimeout(r, delay); });
    delay *= 2;
  }
  return res;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Send welcome email to new subscriber
async function sendWelcomeEmail(apiKey, subscriberEmail) {
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
    '        <h1 style="margin:0;font-size:28px;font-weight:700;line-height:34px;color:#111827;">Welcome to the Freedom Farm News! ⚡️🐽</h1>',
    '      </td></tr>',
    '      <tr><td style="padding:0 40px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-bottom:1px solid #f0f0f0;height:1px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>',
    '      <tr><td style="padding:24px 40px 32px 40px;font-size:16px;line-height:26px;color:#525252;">',
    '        <p style="margin:0 0 16px 0;">Thanks for subscribing to Freedom Farm News.</p>',
    '        <p style="margin:0 0 16px 0;">You\'ll be the first to hear about new features, build guides, and project updates — no hogwash, just oinks.</p>',
    '        <p style="margin:0;">Ready to get started?</p>',
    '      </td></tr>',
    '      <tr><td style="padding:0 40px 40px 40px;" align="center">',
    '        <table role="presentation" cellpadding="0" cellspacing="0"><tr>',
    '          <td style="background-color:#EC008C;border-radius:50px;">',
    '            <a href="https://lightningpiggy.com/build" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;">Build Your Own</a>',
    '          </td>',
    '        </tr></table>',
    '      </td></tr>',
    '    </table>',
    '  </td></tr>',
    '  <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '  <tr><td>',
    '    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#111827;border-radius:16px;overflow:hidden;">',
    '      <tr><td style="padding:32px 40px;">',
    '        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">',
    '          <tr><td align="center" style="padding-bottom:16px;"><img src="https://lightningpiggy.com/images/mascot.png" alt="Lightning Piggy" width="40" height="40" style="display:block;width:40px;height:40px;border-radius:8px;"></td></tr>',
    '          <tr><td align="center" style="padding-bottom:20px;font-size:13px;line-height:20px;color:#9ca3af;">Bitcoin savings for the next generation.</td></tr>',
    '        </table>',
    '        <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr>',
    '          <td style="padding:0 8px;"><a href="https://primal.net/lightningpiggy"><img src="https://lightningpiggy.com/images/email/icon-nostr.png" alt="Nostr" width="24" height="24" style="display:block;width:24px;height:24px;"></a></td>',
    '          <td style="padding:0 8px;"><a href="https://x.com/lightningpiggy"><img src="https://lightningpiggy.com/images/email/icon-x.png" alt="X" width="24" height="24" style="display:block;width:24px;height:24px;"></a></td>',
    '          <td style="padding:0 8px;"><a href="https://t.me/LightningPiggy"><img src="https://lightningpiggy.com/images/email/icon-telegram.png" alt="Telegram" width="24" height="24" style="display:block;width:24px;height:24px;"></a></td>',
    '          <td style="padding:0 8px;"><a href="https://github.com/LightningPiggy"><img src="https://lightningpiggy.com/images/email/icon-github.png" alt="GitHub" width="24" height="24" style="display:block;width:24px;height:24px;"></a></td>',
    '        </tr></table>',
    '        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;">',
    '          <tr><td style="border-bottom:1px solid #1f2937;height:1px;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '        </table>',
    '        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">',
    '          <tr><td align="center" style="font-size:11px;line-height:18px;color:#4b5563;">&copy; 2026 Lightning Piggy. Open source, built with love.</td></tr>',
    '        </table>',
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: 'oink@lightningpiggy.com',
        to: [subscriberEmail],
        subject: 'Welcome to Freedom Farm News!',
        html: html
      })
    });
    if (!res.ok) {
      var text = await res.text();
      console.error('Welcome email error:', res.status, text);
    }
  } catch (err) {
    console.error('Failed to send welcome email:', err.message);
  }
}

// Notify site owner of new subscriber
async function sendOwnerNotification(apiKey, subscriberEmail) {
  var html = [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f5f5f5;"><tr><td align="center" style="padding:24px 16px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;width:100%;">',
    '  <tr><td align="center" style="padding:0 0 24px 0;">',
    '    <img src="https://lightningpiggy.com/images/email/lightningpiggy-logo.png" alt="Lightning Piggy" width="200" style="display:block;width:200px;max-width:200px;height:auto;">',
    '  </td></tr>',
    '  <tr><td>',
    '    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#ffffff;border-radius:16px;overflow:hidden;">',
    '      <tr><td style="background-color:#FFDB00;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>',
    '      <tr><td style="padding:40px 40px 24px 40px;">',
    '        <h1 style="margin:0;font-size:24px;font-weight:700;color:#111827;">New Newsletter Subscriber</h1>',
    '      </td></tr>',
    '      <tr><td style="padding:0 40px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="border-bottom:1px solid #f0f0f0;height:1px;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>',
    '      <tr><td style="padding:24px 40px 40px 40px;font-size:16px;line-height:26px;color:#525252;">',
    '        <p style="margin:0 0 8px 0;font-size:14px;color:#9ca3af;">Email address:</p>',
    '        <p style="margin:0;font-size:18px;font-weight:600;color:#EC008C;">' + escapeHtml(subscriberEmail) + '</p>',
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        reply_to: 'oink@lightningpiggy.com',
        to: [NOTIFICATION_EMAIL],
        subject: 'New subscriber: ' + subscriberEmail,
        html: html
      })
    });
    if (!res.ok) {
      var text = await res.text();
      console.error('Owner notification error:', res.status, text);
    }
  } catch (err) {
    console.error('Failed to send owner notification:', err.message);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  var apiKey = process.env.RESEND_API_KEY;
  var audienceId = process.env.RESEND_AUDIENCE_ID || process.env.RESEND_NEWSLETTER_SEGMENT_ID;
  var secret = process.env.NEWSLETTER_CONFIRM_SECRET;
  if (!apiKey || !audienceId || !secret) {
    console.error('newsletter-confirm: missing RESEND_API_KEY / RESEND_AUDIENCE_ID / NEWSLETTER_CONFIRM_SECRET');
    return redirect('error');
  }

  if (event.httpMethod === 'GET') {
    // A link opened (by a person, or by a mail filter checking it): show the
    // confirm page and change nothing.
    var linkToken = (event.queryStringParameters || {}).token || '';
    logVisit(event, 'link opened');
    if (!verifyToken(linkToken, secret)) return redirect('expired');
    return {
      statusCode: 302,
      headers: { Location: SITE + '/newsletter-confirm?token=' + encodeURIComponent(linkToken), 'Cache-Control': 'no-store' },
      body: ''
    };
  }

  logVisit(event, 'confirm pressed');
  var email = verifyToken(tokenFromPost(event), secret);
  if (!email) return redirect('expired');

  try {
    // Already on the list: nothing to do, and no second welcome or
    // notification. If Resend can't be asked (null), carry on as for a new
    // address.
    var status = await newsletterStatus(apiKey, email, audienceId);
    if (status === 'subscribed') return redirect('ok');

    // Someone who unsubscribed earlier and has now confirmed again.
    if (status === 'unsubscribed') {
      var upd = await fetchWithRetry('https://api.resend.com/contacts/' + encodeURIComponent(email), {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unsubscribed: false })
      });
      if (!upd.ok) {
        var updBody; try { updBody = await upd.json(); } catch (e) { updBody = {}; }
        console.error('newsletter-confirm: Resend error re-subscribing', upd.status, JSON.stringify(updBody));
        return redirect('error');
      }
    }

    var res = await fetchWithRetry('https://api.resend.com/audiences/' + audienceId + '/contacts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, unsubscribed: false })
    });
    if (!res.ok) {
      var errBody; try { errBody = await res.json(); } catch (e) { errBody = {}; }
      console.error('newsletter-confirm: Resend error', res.status, JSON.stringify(errBody));
      return redirect('error');
    }

    // Sequential with a gap to stay under Resend's 2 req/s.
    await sendWelcomeEmail(apiKey, email);
    await sleep(600);
    await sendOwnerNotification(apiKey, email);
    return redirect('ok');
  } catch (err) {
    console.error('newsletter-confirm:', err.message);
    return redirect('error');
  }
};
