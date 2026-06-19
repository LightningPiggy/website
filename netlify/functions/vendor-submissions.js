// Netlify serverless function: admin-only access to pending vendor submissions
// stored in Netlify Blobs (store: "vendor-submissions").
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

const { getStore } = require('@netlify/blobs');

var STORE_NAME = 'vendor-submissions';

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(obj)
  };
}

function authorized(event) {
  var expected = process.env.ADMIN_SYNC_TOKEN;
  if (!expected) return false;
  var hdr = (event.headers || {}).authorization || (event.headers || {}).Authorization || '';
  var token = hdr.replace(/^Bearer\s+/i, '').trim();
  // Constant-ish time compare
  if (token.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

exports.handler = async function (event) {
  if (!process.env.ADMIN_SYNC_TOKEN) {
    return json(500, { error: 'ADMIN_SYNC_TOKEN is not configured on the server.' });
  }
  if (!authorized(event)) {
    return json(401, { error: 'Unauthorized' });
  }

  var store;
  try {
    store = getStore(STORE_NAME);
  } catch (err) {
    return json(502, { error: 'Blob store unavailable: ' + (err && err.message) });
  }

  if (event.httpMethod === 'GET') {
    try {
      var listing = await store.list();
      var blobs = (listing && listing.blobs) || [];
      var submissions = [];
      for (var i = 0; i < blobs.length; i++) {
        var rec = await store.get(blobs[i].key, { type: 'json' });
        if (rec && rec.status === 'pending') submissions.push(rec);
      }
      submissions.sort(function (a, b) {
        return (b.submittedAt || '').localeCompare(a.submittedAt || '');
      });
      return json(200, { submissions: submissions });
    } catch (err) {
      return json(502, { error: 'Failed to list submissions: ' + (err && err.message) });
    }
  }

  if (event.httpMethod === 'POST') {
    var body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return json(400, { error: 'Invalid JSON body' });
    }
    var id = body.id;
    var action = body.action;
    if (!id) return json(400, { error: 'id is required' });
    if (action !== 'imported' && action !== 'dismissed') {
      return json(400, { error: 'action must be "imported" or "dismissed"' });
    }

    try {
      var existing = await store.get(id, { type: 'json' });
      if (!existing) return json(404, { error: 'Submission not found' });

      if (action === 'dismissed') {
        await store.delete(id);
        return json(200, { success: true, id: id, action: 'dismissed' });
      }

      // imported — keep a record but flip status so it's no longer pending
      existing.status = 'imported';
      existing.importedAt = new Date().toISOString();
      await store.setJSON(id, existing);
      return json(200, { success: true, id: id, action: 'imported' });
    } catch (err) {
      return json(502, { error: 'Update failed: ' + (err && err.message) });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
