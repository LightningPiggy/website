// Netlify function (V2): admin-only access to pending vendor submissions
// stored in Netlify Blobs (store: "vendor-submissions").
//
// NOTE: this is a V2 function (default export). V2 is required so Netlify Blobs
// auto-configures — legacy V1 (exports.handler) functions do not.
//
// Protected by a shared secret. The local admin tool calls this with the
// Authorization: Bearer <ADMIN_SYNC_TOKEN> header.
//
//   GET  /.netlify/functions/vendor-submissions
//        → { submissions: [...] } (pending only, newest first)
//
//   POST /.netlify/functions/vendor-submissions
//        body: { id, action: "imported" | "dismissed" }
//        → marks the submission imported (kept for audit) or deletes it
//
// Environment variables (set in Netlify):
//   ADMIN_SYNC_TOKEN — shared secret required to call this function

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'vendor-submissions';

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function authorized(req) {
  const expected = process.env.ADMIN_SYNC_TOKEN;
  if (!expected) return false;
  const hdr = req.headers.get('authorization') || '';
  const token = hdr.replace(/^Bearer\s+/i, '').trim();
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default async (req) => {
  if (!process.env.ADMIN_SYNC_TOKEN) {
    return json(500, { error: 'ADMIN_SYNC_TOKEN is not configured on the server.' });
  }
  if (!authorized(req)) {
    return json(401, { error: 'Unauthorized' });
  }

  let store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return json(502, { error: 'Blob store unavailable: ' + (err && err.message) });
  }

  if (req.method === 'GET') {
    try {
      const listing = await store.list();
      const blobs = (listing && listing.blobs) || [];
      const submissions = [];
      for (const b of blobs) {
        const rec = await store.get(b.key, { type: 'json' });
        if (rec && rec.status === 'pending') submissions.push(rec);
      }
      submissions.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
      return json(200, { submissions });
    } catch (err) {
      return json(502, { error: 'Failed to list submissions: ' + (err && err.message) });
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return json(400, { error: 'Invalid JSON body' });
    }
    const id = body.id;
    const action = body.action;
    if (!id) return json(400, { error: 'id is required' });
    if (action !== 'imported' && action !== 'dismissed') {
      return json(400, { error: 'action must be "imported" or "dismissed"' });
    }

    try {
      const existing = await store.get(id, { type: 'json' });
      if (!existing) return json(404, { error: 'Submission not found' });

      if (action === 'dismissed') {
        await store.delete(id);
        return json(200, { success: true, id, action: 'dismissed' });
      }

      existing.status = 'imported';
      existing.importedAt = new Date().toISOString();
      await store.setJSON(id, existing);
      return json(200, { success: true, id, action: 'imported' });
    } catch (err) {
      return json(502, { error: 'Update failed: ' + (err && err.message) });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
