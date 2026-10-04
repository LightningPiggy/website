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

// Every format of a purchased model, for the receipt. The private bundle is
// included with this function (netlify.toml); if it is ever missing, fall back
// to the single purchased file rather than failing the receipt.
function modelFormats(fileId) {
  try {
    const lib = require('./lib/downloads');
    lib.privateDir();   // throws with a clear message if the bundle is missing
    const found = lib.formatsFor(fileId);
    if (!found.length) console.error('receipt: no bundled files found for', fileId);
    return found.length ? found : [fileId];
  } catch (e) {
    console.error('receipt: could not list model formats, sending a single link:', e.message);
    return [fileId];
  }
}

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

// Receipt for a buy-to-support model download: to the buyer (if BTCPay
// collected an email at checkout) with the durable download link, and a
// short note to the owner. Never fails the webhook.
async function sendDownloadReceipt(amount, currency, metadata, invoiceId) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const fileId = String(metadata.fileId || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,80}\.(3mf|stl|step|stp)$/i.test(fileId)) return;
  const linkFor = (f) => 'https://lightningpiggy.com/.netlify/functions/download?invoice=' + encodeURIComponent(invoiceId) + '&file=' + encodeURIComponent(f);
  const link = linkFor(fileId);
  const fmtLabel = (f) => { const e = f.split('.').pop().toLowerCase(); return e === 'stp' ? 'STEP' : e.toUpperCase(); };
  // One payment covers every format of the model; list the others under the main button.
  const otherFormats = modelFormats(fileId).filter((f) => f !== fileId);
  const ext = fileId.split('.').pop().toLowerCase();
  const niceName = fileId.replace(/^lightningpiggy-v\d-/, '').replace(/\.[a-z0-9]+$/i, '').replace(/-/g, ' ') + ' (' + (ext === 'stp' ? 'STEP' : ext.toUpperCase()) + ')';
  const formatNote = ext === 'stl'
    ? 'The file is an STL mesh: the shape only. Import it into your slicer and choose your own material, supports and settings; the <a href="https://lightningpiggy.com/build/cases" style="color:#EC008C;">cases page</a> has printing notes for each design.'
    : (ext === 'step' || ext === 'stp')
      ? 'The file is a STEP CAD model, the best format for remixing: open it in CAD software to change dimensions, then export an STL or 3MF to print.'
      : 'The file is a sliced 3MF project. Open it in your slicer to see the plates, materials and print settings the designer used; the <a href="https://lightningpiggy.com/build/cases" style="color:#EC008C;">cases page</a> has printing notes for each design.';
  const paid = '$' + escapeHtml(String(amount)) + ' ' + escapeHtml(currency);
  const when = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const send = (to, subject, html) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    // mail.lightningpiggy.com has no MX, so replies ("Just reply to this email") need reply_to.
    body: JSON.stringify({ from: 'Lightning Piggy <newsletter@mail.lightningpiggy.com>', reply_to: 'oink@lightningpiggy.com', to: [to], subject, html }),
  }).catch((e) => console.error('receipt email failed:', e.message));

  const buyer = typeof metadata.buyerEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(metadata.buyerEmail) ? metadata.buyerEmail : null;
  if (buyer) {
    const html = [
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
      '      <tr><td style="padding:40px 40px 16px 40px;">',
      '        <h1 style="margin:0;font-size:26px;font-weight:700;line-height:32px;color:#111827;">Thank you for supporting Lightning Piggy 🐽</h1>',
      '      </td></tr>',
      '      <tr><td style="padding:0 40px 8px 40px;font-size:16px;line-height:26px;color:#525252;">',
      '        <p style="margin:0 0 16px 0;">Your contribution helps keep Lightning Piggy free, open source, and in the hands of the next generation of savers. It means a lot - thank you.</p>',
      '        <p style="margin:0 0 16px 0;">' + (otherFormats.length ? 'Your model files are ready to download. Your support covers every format of this model:' : 'Your model file is ready to download:') + '</p>',
      '      </td></tr>',
      '      <tr><td style="padding:0 40px 8px 40px;" align="center">',
      '        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background-color:#EC008C;border-radius:50px;">',
      '          <a href="' + link + '" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:50px;">Download ' + escapeHtml(niceName) + '</a>',
      '        </td></tr></table>',
      '        <p style="margin:12px 0 0 0;font-size:12px;line-height:18px;color:#9ca3af;">' + escapeHtml(fileId) + '</p>',
      otherFormats.length
        ? '        <p style="margin:16px 0 0 0;font-size:14px;line-height:22px;color:#525252;">Also included: ' +
          otherFormats.map((f) => '<a href="' + linkFor(f) + '" style="color:#EC008C;font-weight:600;">Download ' + escapeHtml(fmtLabel(f)) + '</a>').join(' &middot; ') + '</p>'
        : '',
      '      </td></tr>',
      '      <tr><td style="padding:16px 40px 0 40px;">',
      '        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f9fafb;border-radius:12px;">',
      '          <tr><td style="padding:16px 20px;font-size:14px;line-height:22px;color:#525252;">',
      '            <strong style="color:#111827;">Your receipt</strong><br>',
      '            Contribution: ' + paid + '<br>',
      '            Date: ' + escapeHtml(when) + '<br>',
      '            Reference: <span style="font-family:monospace;">' + escapeHtml(invoiceId) + '</span>',
      '          </td></tr>',
      '        </table>',
      '      </td></tr>',
      '      <tr><td style="padding:24px 40px 8px 40px;font-size:15px;line-height:24px;color:#525252;">',
      '        <p style="margin:0 0 12px 0;"><strong style="color:#111827;">A few things worth knowing</strong></p>',
      '        <ul style="margin:0 0 16px 0;padding-left:20px;">',
      '          <li style="margin-bottom:8px;">The download button above keeps working, so please keep this email if you ever need the file again.</li>',
      '          <li style="margin-bottom:8px;">The model is licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" style="color:#EC008C;">CC BY-SA 4.0</a>. You are free to print it, share it, and remix it - just credit the designer and share your changes under the same terms.</li>',
      '          <li style="margin-bottom:8px;">' + formatNote + '</li>',
      '        </ul>',
      '        <p style="margin:0 0 16px 0;">Once your piggy is built, we would love to see it. Post a photo on Nostr tagging <a href="https://njump.me/npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq" style="color:#EC008C;">@LightningPiggy</a> or email it to <a href="mailto:oink@lightningpiggy.com" style="color:#EC008C;">oink@lightningpiggy.com</a>, and it may appear on our <a href="https://lightningpiggy.com/community/wild" style="color:#EC008C;">In the Wild</a> page.</p>',
      '        <p style="margin:0 0 24px 0;">Questions, or something not working? Just reply to this email, or find us on <a href="https://t.me/LightningPiggy" style="color:#EC008C;">Telegram</a>.</p>',
      '        <p style="margin:0 0 32px 0;">With thanks,<br><strong style="color:#111827;">The Lightning Piggy team</strong></p>',
      '      </td></tr>',
      '    </table>',
      '  </td></tr>',
      '  <tr><td align="center" style="padding:24px 16px 0;font-size:11px;line-height:18px;color:#9ca3af;">&copy; ' + new Date().getFullYear() + ' Lightning Piggy. Open source, built with love.</td></tr>',
      '</table>',
      '</td></tr></table>',
      '</body></html>',
    ].join('\n');
    await send(buyer, 'Thank you - your Lightning Piggy model file', html);
  }
  await send('oink@lightningpiggy.com', 'Model download: ' + fileId + ' (' + '$' + amount + ' ' + currency + ')',
    '<p>' + escapeHtml(fileId) + (otherFormats.length ? ' (+ ' + otherFormats.map((f) => escapeHtml(fmtLabel(f))).join(', ') + ')' : '') + ' - ' + paid + (buyer ? ' - ' + escapeHtml(buyer) : ' - no email given') + '<br>Invoice ' + escapeHtml(invoiceId) + '</p>');
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
    // InvoiceSettled can arrive several times. Stamp the entry with a hash of
    // the invoice id and use the file itself as the idempotency record,
    // otherwise a retry adds the same donor to the public wall again. The raw
    // id is not published: anyone holding it can open the invoice on BTCPay
    // and see the exact amount.
    const invoiceRef = invoiceId ? crypto.createHash('sha256').update(String(invoiceId)).digest('hex').slice(0, 16) : null;
    if (invoiceRef && supporters.some((s) => s && s.invoiceRef === invoiceRef)) {
      console.log('Supporter already recorded for invoice', invoiceId, '- skipping');
      return true;
    }

    // Append new supporter
    const entry = { avatarUrl: avatarUrl, addedAt: new Date().toISOString() };
    if (profileUrl) entry.profileUrl = profileUrl;
    if (invoiceRef) entry.invoiceRef = invoiceRef;
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

  // Buy-to-support downloads share this store but are not donations: no
  // supporters wall, and the buyer gets a receipt carrying a re-download link.
  if (metadata.itemCode === 'download') {
    await sendDownloadReceipt(amount, currency, metadata, invoiceId);
    return { statusCode: 200, body: 'OK (download)' };
  }

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