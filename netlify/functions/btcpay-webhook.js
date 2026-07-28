// Netlify serverless function: receives BTCPay Server webhook on invoice settlement,
// sends an email notification via Resend, and adds generous supporters ($50+) to
// the supporters.json data file via GitHub API (triggers site rebuild).
//
// Environment variables required in Netlify:
//   BTCPAY_WEBHOOK_SECRET — webhook secret configured in BTCPay Server
//   BTCPAY_STORE_ID       — store ID from BTCPay Server
//   RESEND_API_KEY        — API key from resend.com
//   GITHUB_TOKEN          — fine-grained PAT with contents:write on this repo

const crypto = require('crypto');

const BTCPAY_URL = 'https://btcpay.lightningpiggy.com';
const NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
const FROM_EMAIL = 'Lightning Piggy <donations@mail.lightningpiggy.com>';

const GITHUB_REPO = 'LightningPiggy/website';
const SUPPORTERS_PATH = 'src/data/supporters.json';

const STORE_ID = process.env.BTCPAY_STORE_ID;

function verifySignature(payload, secret, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch (e) {
    return false;
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Send email notification via Resend
async function sendEmailNotification(amount, currency, metadata) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set, skipping email notification');
    return;
  }

  const details = [];
  if (metadata.nostrNpub) {
    const primalLink = 'https://primal.net/p/' + encodeURIComponent(metadata.nostrNpub);
    details.push('Nostr: <a href="' + primalLink + '" style="color:#e91e8c;">' + escapeHtml(metadata.nostrNpub.slice(0, 20)) + '...</a>');
  }
  if (metadata.xHandle) {
    const handle = metadata.xHandle.replace(/^@/, '');
    const xLink = 'https://x.com/' + encodeURIComponent(handle);
    details.push('X: <a href="' + xLink + '" style="color:#e91e8c;">@' + escapeHtml(handle) + '</a>');
  }
  const detailsHtml = details.length > 0
    ? '<p style="color:#666;margin-top:8px;">' + details.join('<br>') + '</p>'
    : '';

  const html = [
    '<div style="font-family:sans-serif;max-width:480px;">',
    '  <h2 style="color:#e91e8c;">New Donation Received!</h2>',
    '  <p style="font-size:24px;font-weight:bold;">$' + escapeHtml(amount) + ' ' + escapeHtml(currency) + '</p>',
    detailsHtml,
    '  <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">',
    '  <p style="color:#999;font-size:12px;">Lightning Piggy Donation System</p>',
    '</div>'
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFICATION_EMAIL],
        subject: 'New donation: $' + amount + ' ' + currency,
        html: html
      })
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Resend API error:', res.status, text);
    }
  } catch (err) {
    console.error('Failed to send email notification:', err);
  }
}

// Add supporter avatar (+ optional profile link) to supporters.json via GitHub API
async function addSupporter(avatarUrl, profileUrl, invoiceId) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not set, skipping supporter commit');
    return;
  }

  const apiBase = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + SUPPORTERS_PATH;
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'LightningPiggy-Webhook'
  };

  async function attemptCommit() {
    // Fetch current file
    const getRes = await fetch(apiBase, { headers });
    if (!getRes.ok) {
      const text = await getRes.text();
      throw new Error('GitHub GET failed: ' + getRes.status + ' ' + text);
    }

    const fileData = await getRes.json();
    const currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const supporters = JSON.parse(currentContent);

    // BTCPay re-delivers a webhook until it gets a 2xx, so the same
    // InvoiceSettled can arrive several times. Stamp the invoice id on the
    // entry and use the file itself as the idempotency record, otherwise a
    // retry adds the same donor to the public wall again.
    if (invoiceId && supporters.some((s) => s && s.invoiceId === invoiceId)) {
      console.log('Supporter already recorded for invoice', invoiceId, '- skipping');
      return true;
    }

    // Append new supporter
    const entry = { avatarUrl: avatarUrl, addedAt: new Date().toISOString() };
    if (profileUrl) entry.profileUrl = profileUrl;
    if (invoiceId) entry.invoiceId = invoiceId;
    supporters.push(entry);

    // Commit updated file
    const newContent = Buffer.from(JSON.stringify(supporters, null, 2) + '\n').toString('base64');
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Add generous supporter',
        content: newContent,
        sha: fileData.sha
      })
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error('GitHub PUT failed: ' + putRes.status + ' ' + text);
    }
  }

  // Try once, retry on 409 conflict (concurrent commits)
  try {
    if (await attemptCommit()) return; // already recorded — nothing to log
    console.log('Supporter added to supporters.json');
  } catch (err) {
    if (err.message && err.message.includes('409')) {
      console.log('Conflict detected, retrying...');
      try {
        if (await attemptCommit()) return;
        console.log('Supporter added on retry');
      } catch (retryErr) {
        console.error('Failed to add supporter on retry:', retryErr);
      }
    } else {
      console.error('Failed to add supporter:', err);
    }
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify webhook signature
  const secret = process.env.BTCPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('BTCPAY_WEBHOOK_SECRET not set');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const signature = event.headers['btcpay-sig'];
  if (!verifySignature(event.body, secret, signature)) {
    console.error('Invalid webhook signature');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  // Parse webhook payload
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only process settled invoices
  if (payload.type !== 'InvoiceSettled') {
    return { statusCode: 200, body: 'Ignored: ' + (payload.type || 'unknown event type') };
  }

  const invoiceId = payload.invoiceId;
  if (!invoiceId) {
    return { statusCode: 200, body: 'No invoiceId in payload' };
  }

  // Fetch full invoice details from BTCPay
  const apiKey = process.env.BTCPAY_API_KEY;
  if (!apiKey) {
    console.error('BTCPAY_API_KEY not set');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  let invoice;
  try {
    const res = await fetch(
      BTCPAY_URL + '/api/v1/stores/' + STORE_ID + '/invoices/' + invoiceId,
      {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error('BTCPay invoice fetch error:', res.status, text);
      return { statusCode: 502, body: 'Failed to fetch invoice' };
    }

    invoice = await res.json();
  } catch (err) {
    console.error('Failed to fetch invoice:', err);
    return { statusCode: 502, body: 'Failed to fetch invoice' };
  }

  const amount = invoice.amount || '0';
  const currency = invoice.currency || 'USD';
  const metadata = invoice.metadata || {};

  // Send email notification (don't fail the webhook if this errors)
  await sendEmailNotification(amount, currency, metadata);

  // Add supporter if they donated $50+ and have a validated avatar
  const numericAmount = parseFloat(amount);
  if (numericAmount >= 50 && metadata.avatarUrl) {
    const url = metadata.avatarUrl;
    if (url.startsWith('https://primal.b-cdn.net/') || url.startsWith('https://unavatar.io/')) {
      // Link the avatar to their public profile when we have one.
      let profileUrl = '';
      if (metadata.nostrNpub) {
        profileUrl = 'https://primal.net/p/' + encodeURIComponent(metadata.nostrNpub);
      } else if (metadata.xHandle) {
        profileUrl = 'https://x.com/' + encodeURIComponent(metadata.xHandle.replace(/^@/, ''));
      }
      await addSupporter(url, profileUrl, invoiceId);
    } else {
      console.warn('Ignoring untrusted avatar URL:', url);
    }
  }

  return { statusCode: 200, body: 'OK' };
};