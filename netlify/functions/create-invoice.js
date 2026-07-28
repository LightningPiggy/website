// Netlify serverless function: proxies donation invoice creation to BTCPay Server
// Keeps the API key server-side so it's never exposed to the browser.
//
// Environment variables required in Netlify:
//   BTCPAY_API_KEY  — API key with btcpay.store.cancreateinvoice permission
//   BTCPAY_STORE_ID — store ID from BTCPay Server

const BTCPAY_URL = 'https://btcpay.lightningpiggy.com';
const STORE_ID = process.env.BTCPAY_STORE_ID;

var ALLOWED_ORIGIN = 'https://lightningpiggy.com';

// Accept only the exact shape validate-profile emits for a Nostr avatar:
// the Primal media-cache endpoint wrapping an https image URL. Anything else
// (a different host, a non-https `u`, a missing `u`) is rejected.
function isResolvedNostrAvatar(raw) {
  try {
    var u = new URL(raw);
    if (u.origin !== 'https://primal.b-cdn.net' || u.pathname !== '/media-cache') return false;
    var inner = u.searchParams.get('u');
    return !!inner && new URL(inner).protocol === 'https:';
  } catch (e) {
    return false;
  }
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

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.BTCPAY_API_KEY;
  if (!apiKey) {
    console.error('BTCPAY_API_KEY environment variable is not set');
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  // Parse and validate the request body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0 || amount > 10000) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid amount. Must be between $1 and $10,000.' }) };
  }

  // Build the BTCPay invoice payload
  const invoicePayload = {
    amount: String(amount),
    currency: 'USD',
    metadata: {}
  };

  // Only include metadata fields if provided
  if (body.metadata) {
    if (body.metadata.nostrNpub && typeof body.metadata.nostrNpub === 'string') {
      invoicePayload.metadata.nostrNpub = body.metadata.nostrNpub.trim().slice(0, 200);
    }
    if (body.metadata.xHandle && typeof body.metadata.xHandle === 'string') {
      invoicePayload.metadata.xHandle = body.metadata.xHandle.trim().slice(0, 100);
    }
    // Avatar URL. A bare prefix check is not enough: the Primal media-cache
    // endpoint proxies whatever is in its `u=` parameter, so
    // `https://primal.b-cdn.net/media-cache?...&u=<anything>` passes a
    // startsWith() test while serving an arbitrary attacker-supplied image —
    // which btcpay-webhook then commits to the public supporters wall.
    //
    // So don't take the client's string on trust:
    //   • X handles produce a fully deterministic URL, so rebuild it here and
    //     ignore whatever was sent.
    //   • The Nostr path can only be resolved against relays (validate-profile
    //     does that), so accept it solely in the exact shape that function
    //     emits, with an https target.
    const avatarFromX = invoicePayload.metadata.xHandle
      ? 'https://unavatar.io/twitter/' +
        encodeURIComponent(invoicePayload.metadata.xHandle.replace(/^@/, ''))
      : null;

    if (avatarFromX) {
      invoicePayload.metadata.avatarUrl = avatarFromX;
    } else if (body.metadata.avatarUrl && typeof body.metadata.avatarUrl === 'string') {
      const raw = body.metadata.avatarUrl.trim().slice(0, 500);
      if (isResolvedNostrAvatar(raw)) invoicePayload.metadata.avatarUrl = raw;
    }
  }

  try {
    const response = await fetch(
      `${BTCPAY_URL}/api/v1/stores/${STORE_ID}/invoices`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `token ${apiKey}`
        },
        body: JSON.stringify(invoicePayload)
      }
    );

    const data = await response.text();

    if (!response.ok) {
      console.error('BTCPay API error:', response.status, data);
      return {
        statusCode: response.status,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Failed to create invoice' })
      };
    }

    // Parse and return only the fields the client needs
    const invoice = JSON.parse(data);
    return {
      statusCode: 200,
      headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(event)),
      body: JSON.stringify({
        checkoutLink: invoice.checkoutLink,
        id: invoice.id
      })
    };
  } catch (err) {
    console.error('Error calling BTCPay API:', err);
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to reach BTCPay Server' })
    };
  }
};
