// Netlify serverless function: delivers a purchased model file. Stateless -
// it asks BTCPay whether the invoice is settled and was paid for this model,
// then streams the file from the private bundle. One payment covers every
// format of the model, so an invoice for zapbox.3mf also unlocks zapbox.stl.
//   GET ?invoice=<id>&file=<name>.<3mf|stl|step> -> the file (attachment)
//   GET ?invoice=<id>&file=<name>.<ext>&check=1  -> JSON status, no file
const fs = require('fs');
const { resolveFile, corsHeaders, getInvoice, contentTypeFor, sameModel, formatsFor } = require('./lib/downloads');

const json = (event, status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...corsHeaders(event) }, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(event), body: '' };
  if (event.httpMethod !== 'GET') return json(event, 405, { error: 'Method not allowed' });
  if (!process.env.BTCPAY_API_KEY || !process.env.BTCPAY_STORE_ID) return json(event, 500, { error: 'Server configuration error' });

  const q = event.queryStringParameters || {};
  const fileId = String(q.file || '');
  const invoiceId = String(q.invoice || '');
  const full = resolveFile(fileId);
  if (!full) return json(event, 404, { error: 'Unknown file' });
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(invoiceId)) return json(event, 400, { error: 'Invalid invoice id' });

  const inv = await getInvoice(invoiceId);
  if (!inv) return json(event, 404, { status: 'unknown', error: 'Invoice not found' });
  const md = inv.metadata || {};
  if (md.itemCode !== 'download' || !sameModel(md.fileId, fileId)) return json(event, 403, { status: 'mismatch', error: 'This invoice is not for that model' });

  // BTCPay invoice states: New, Processing, Settled, Expired, Invalid.
  if (inv.status === 'Settled') {
    if (q.check) return json(event, 200, { status: 'settled', formats: formatsFor(fileId) });
    const data = fs.readFileSync(full);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentTypeFor(fileId),
        'Content-Disposition': `attachment; filename="${fileId}"`,
        'Content-Length': String(data.length),
        'Cache-Control': 'private, no-store',
        ...corsHeaders(event),
      },
      body: data.toString('base64'),
      isBase64Encoded: true,
    };
  }
  if (inv.status === 'Processing') return json(event, 202, { status: 'processing' });   // paid, awaiting confirmation
  if (inv.status === 'New') return json(event, 402, { status: 'unpaid' });
  return json(event, 410, { status: inv.status.toLowerCase() });                          // Expired / Invalid
};
