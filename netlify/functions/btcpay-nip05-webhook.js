// Netlify serverless function: receives BTCPay webhook on NIP-05 invoice settlement,
// adds the purchased handle to public/.well-known/nostr.json via GitHub API
// (triggers site rebuild), and sends an email notification via Resend.
//
// Environment variables required:
//   BTCPAY_NIP05_WEBHOOK_SECRET — webhook secret for the NIP-05 BTCPay store
//   BTCPAY_NIP05_API_KEY        — API key for the NIP-05 BTCPay store
//   BTCPAY_NIP05_STORE_ID       — store ID for the NIP-05 BTCPay store
//   GITHUB_TOKEN                — fine-grained PAT with contents:write on this repo
//   RESEND_API_KEY              — API key from resend.com

var crypto = require('crypto');

var BTCPAY_URL = 'https://btcpay.lightningpiggy.com';
var NOTIFICATION_EMAIL = 'oink@lightningpiggy.com';
var FROM_EMAIL = 'Lightning Piggy <nip05@mail.lightningpiggy.com>';

var GITHUB_REPO = 'LightningPiggy/website';
var NOSTR_JSON_PATH = 'public/.well-known/nostr.json';

var DEFAULT_RELAYS = [
  'wss://relay.primal.net',
  'wss://nostr.oxtr.dev',
  'wss://relay.ditto.pub',
  'wss://nos.lol',
  'wss://relay.nostr.net'
];

function verifySignature(payload, secret, signatureHeader) {
  if (!signatureHeader) return false;
  var expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch (e) {
    return false;
  }
}

// Add NIP-05 handle to nostr.json via GitHub API
async function addNip05Handle(handle, hex) {
  var token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN not set, cannot add NIP-05 handle');
    return;
  }

  var apiBase = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + NOSTR_JSON_PATH;
  var headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'LightningPiggy-NIP05'
  };

  async function attemptCommit() {
    // Fetch current file
    var getRes = await fetch(apiBase, { headers: headers });
    if (!getRes.ok) {
      var text = await getRes.text();
      throw new Error('GitHub GET failed: ' + getRes.status + ' ' + text);
    }

    var fileData = await getRes.json();
    var currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    var nostrData = JSON.parse(currentContent);

    // Guard: don't overwrite an existing handle
    if (nostrData.names[handle]) {
      console.warn('NIP-05 handle "' + handle + '" already exists, skipping commit');
      return;
    }

    // Add the new handle
    nostrData.names[handle] = hex;

    // Add default relays for this pubkey (if not already present)
    if (!nostrData.relays[hex]) {
      nostrData.relays[hex] = DEFAULT_RELAYS;
    }

    // Commit updated file
    var newContent = Buffer.from(JSON.stringify(nostrData, null, 2) + '\n').toString('base64');
    var putRes = await fetch(apiBase, {
      method: 'PUT',
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message: 'Add NIP-05: ' + handle + '@lightningpiggy.com',
        content: newContent,
        sha: fileData.sha
      })
    });

    if (!putRes.ok) {
      var putText = await putRes.text();
      throw new Error('GitHub PUT failed: ' + putRes.status + ' ' + putText);
    }
  }

  // Try once, retry on 409 conflict
  try {
    await attemptCommit();
    console.log('NIP-05 handle added: ' + handle + '@lightningpiggy.com');
  } catch (err) {
    if (err.message && err.message.includes('409')) {
      console.log('Conflict detected, retrying NIP-05 commit...');
      try {
        await attemptCommit();
        console.log('NIP-05 handle added on retry');
      } catch (retryErr) {
        console.error('Failed to add NIP-05 handle on retry:', retryErr);
      }
    } else {
      console.error('Failed to add NIP-05 handle:', err);
    }
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Send email notification via Resend
async function sendEmailNotification(handle, npub, amount, currency) {
  var apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set, skipping email notification');
    return;
  }

  var html = [
    '<div style="font-family:sans-serif;max-width:480px;">',
    '  <h2 style="color:#e91e8c;">New NIP-05 Handle Purchased!</h2>',
    '  <p style="font-size:18px;font-weight:bold;">' + escapeHtml(handle) + '@lightningpiggy.com</p>',
    '  <p style="color:#666;">Amount: $' + escapeHtml(amount) + ' ' + escapeHtml(currency) + '</p>',
    '  <p style="color:#666;">npub: ' + escapeHtml(npub || 'N/A') + '</p>',
    '  <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">',
    '  <p style="color:#999;font-size:12px;">Lightning Piggy NIP-05 Service</p>',
    '</div>'
  ].join('\n');

  try {
    var res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFICATION_EMAIL],
        subject: 'NIP-05 purchase: ' + handle + '@lightningpiggy.com',
        html: html
      })
    });

    if (!res.ok) {
      var text = await res.text();
      console.error('Resend API error:', res.status, text);
    }
  } catch (err) {
    console.error('Failed to send NIP-05 email notification:', err);
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  // Verify webhook signature
  var secret = process.env.BTCPAY_NIP05_WEBHOOK_SECRET;
  if (!secret) {
    console.error('BTCPAY_NIP05_WEBHOOK_SECRET not set');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  var signature = event.headers['btcpay-sig'];
  if (!verifySignature(event.body, secret, signature)) {
    console.error('Invalid webhook signature');
    return { statusCode: 403, body: 'Invalid signature' };
  }

  // Parse webhook payload
  var payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only process settled invoices
  if (payload.type !== 'InvoiceSettled') {
    return { statusCode: 200, body: 'Ignored: ' + (payload.type || 'unknown event type') };
  }

  var invoiceId = payload.invoiceId;
  if (!invoiceId) {
    return { statusCode: 200, body: 'No invoiceId in payload' };
  }

  // Fetch full invoice details from BTCPay
  var apiKey = process.env.BTCPAY_NIP05_API_KEY;
  var storeId = process.env.BTCPAY_NIP05_STORE_ID;
  if (!apiKey || !storeId) {
    console.error('BTCPAY_NIP05_API_KEY or BTCPAY_NIP05_STORE_ID not set');
    return { statusCode: 500, body: 'Server configuration error' };
  }

  var invoice;
  try {
    var res = await fetch(
      BTCPAY_URL + '/api/v1/stores/' + storeId + '/invoices/' + invoiceId,
      {
        headers: { 'Authorization': 'Bearer ' + apiKey }
      }
    );

    if (!res.ok) {
      var text = await res.text();
      console.error('BTCPay invoice fetch error:', res.status, text);
      return { statusCode: 502, body: 'Failed to fetch invoice' };
    }

    invoice = await res.json();
  } catch (err) {
    console.error('Failed to fetch invoice:', err);
    return { statusCode: 502, body: 'Failed to fetch invoice' };
  }

  var amount = invoice.amount || '0';
  var currency = invoice.currency || 'USD';
  var metadata = invoice.metadata || {};

  var handle = metadata.nip05Handle;
  var hex = metadata.nostrHex;
  var npub = metadata.nostrNpub;

  if (!handle || !hex) {
    console.error('NIP-05 invoice missing handle or hex in metadata:', metadata);
    return { statusCode: 200, body: 'Missing NIP-05 metadata' };
  }

  // Re-validate handle and hex to prevent injection via direct BTCPay API access
  if (!/^[a-z0-9][a-z0-9_-]{0,30}[a-z0-9]$|^[a-z0-9]$/.test(handle)) {
    console.error('Invalid handle format in invoice metadata:', handle);
    return { statusCode: 200, body: 'Invalid handle format' };
  }
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    console.error('Invalid hex format in invoice metadata:', hex);
    return { statusCode: 200, body: 'Invalid hex format' };
  }

  // Add handle to nostr.json (don't fail the webhook if this errors)
  await addNip05Handle(handle, hex);

  // Send email notification
  await sendEmailNotification(handle, npub, amount, currency);

  return { statusCode: 200, body: 'OK' };
};
