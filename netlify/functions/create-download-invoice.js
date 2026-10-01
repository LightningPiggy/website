// Netlify serverless function: creates a BTCPay invoice for a buy-to-support
// model download. The files are CC BY-SA - payment supports the project and
// unlocks the download; the `download` function delivers once settled.
//
// Environment variables required in Netlify:
//   BTCPAY_API_KEY, BTCPAY_STORE_ID  — same main store as the donate page
const { SITE, BTCPAY_URL, resolveFile, corsHeaders, minimumFor, MAX_USD, stemOf, formatsFor, formatLabel } = require('./lib/downloads');
const crypto = require('crypto');


exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(event), body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!process.env.BTCPAY_API_KEY || !process.env.BTCPAY_STORE_ID) {
    console.error('BTCPAY_API_KEY / BTCPAY_STORE_ID not set');
    return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const fileId = String(body.file || '');
  if (!resolveFile(fileId)) return { statusCode: 404, headers: corsHeaders(event), body: JSON.stringify({ error: 'Unknown file' }) };

  const minUsd = minimumFor(fileId);
  const amount = Math.round(parseFloat(body.amount) * 100) / 100;
  if (!amount || amount < minUsd || amount > MAX_USD) {
    return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: `Amount must be between $${minUsd} and $${MAX_USD}.` }) };
  }

  // Optional receipt email. Stored as BTCPay's buyerEmail so the checkout
  // does not ask again and btcpay-webhook can send the receipt + download link.
  let buyerEmail;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    const e = String(body.email).trim();
    if (e.length > 254 || !/^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/.test(e)) {
      return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'That email address does not look right.' }) };
    }
    buyerEmail = e;
  }

  const orderId = 'dl-' + crypto.randomBytes(6).toString('hex');
  const payload = {
    amount: String(amount),
    currency: 'USD',
    // fileId is the format the buyer clicked; the payment covers every format
    // of the model (modelId), which the download function honours.
    metadata: {
      itemCode: 'download', fileId, modelId: stemOf(fileId), orderId,
      itemDesc: `Support & download: ${stemOf(fileId)} (${[...new Set(formatsFor(fileId).map(formatLabel))].join(', ') || formatLabel(fileId)})`,
      ...(buyerEmail ? { buyerEmail } : {}),
    },
    checkout: {
      // BTCPay substitutes {InvoiceId}; the cases page picks it up and polls `download`.
      redirectURL: `${SITE}/build/cases/?dl=${encodeURIComponent(fileId)}&invoice={InvoiceId}`,
      redirectAutomatically: true,
      // Asks for an email at checkout so btcpay-webhook can send a receipt with
      // a re-download link (stored by BTCPay as metadata.buyerEmail).
      requiresRefundEmail: true,
    },
  };

  try {
    const res = await fetch(`${BTCPAY_URL}/api/v1/stores/${process.env.BTCPAY_STORE_ID}/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `token ${process.env.BTCPAY_API_KEY}` },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error('BTCPay API error:', res.status, text);
      return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to create invoice' }) };
    }
    const inv = JSON.parse(text);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders(event) }, body: JSON.stringify({ id: inv.id, checkoutLink: inv.checkoutLink }) };
  } catch (err) {
    console.error('BTCPay fetch error:', err.message);
    return { statusCode: 502, headers: corsHeaders(event), body: JSON.stringify({ error: 'Failed to create invoice' }) };
  }
};
