// Shared JSON-store + CRUD-router helpers for the admin server.
//
// The admin tool keeps several list-shaped stores (credits, partners,
// testimonials, vendors) in `{ <key>: [...], schema_version }` JSON files, each
// with the same load/init/save and GET/POST/PUT-reorder/PUT-:id/DELETE-:id REST
// surface. These helpers hold that shared machinery so each resource only has to
// declare its own fields (build/merge) and any post-save hook.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import express from 'express';

// Write JSON via a temp file + atomic rename, so a crash or full disk mid-write
// can't truncate/corrupt the source-of-truth data file (which the site build
// consumes). rename() within the same directory is atomic on the same volume.
export function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// Read a store file, creating an empty `{ [key]: [], schema_version: 1 }` on
// first use, and falling back to an empty store on any read/parse error.
export function loadStore(file, key) {
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeJsonAtomic(file, { [key]: [], schema_version: 1 });
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return { [key]: [], schema_version: 1 };
  }
}

export function saveStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, data);
}

// Build an Express router with the standard CRUD surface for one list store.
//   load()/save(data) — the resource's own load/save (so post-save website
//                        sync and any other side effects are preserved).
//   key               — the array property inside the store file.
//   singular          — response label + 404 message ("credit", "vendor", …).
//   build(body)       — returns a new item (WITHOUT id; the router adds a UUID).
//   merge(existing, body) — returns the updated item for PUT /:id.
//   afterWrite(item) — optional; called after a successful create/update, for
//                      side effects that must not run on the store's own
//                      internal writes (e.g. avatar localisation).
export function crudRouter({ load, save, key, singular, build, merge, afterWrite }) {
  const r = express.Router();
  const Singular = singular.charAt(0).toUpperCase() + singular.slice(1);
  const notify = (item) => {
    if (afterWrite) {
      try { afterWrite(item); } catch { /* side effect must never fail the write */ }
    }
  };

  r.get('/', (req, res) => res.json(load()[key]));

  r.post('/', (req, res) => {
    try {
      const data = load();
      const item = { id: crypto.randomUUID(), ...build(req.body) };
      data[key].push(item);
      save(data);
      notify(item);
      res.json({ success: true, [singular]: item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Must be registered before /:id so "reorder" isn't captured as an id.
  r.put('/reorder', (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' });
      const data = load();
      const byId = new Map(data[key].map((x) => [x.id, x]));
      const seen = new Set(ids);
      const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
      for (const x of data[key]) if (!seen.has(x.id)) reordered.push(x); // keep any not listed
      data[key] = reordered;
      save(data);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  r.put('/:id', (req, res) => {
    try {
      const data = load();
      const i = data[key].findIndex((x) => x.id === req.params.id);
      if (i === -1) return res.status(404).json({ error: `${Singular} not found` });
      data[key][i] = merge(data[key][i], req.body);
      save(data);
      notify(data[key][i]);
      res.json({ success: true, [singular]: data[key][i] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  r.delete('/:id', (req, res) => {
    try {
      const data = load();
      const i = data[key].findIndex((x) => x.id === req.params.id);
      if (i === -1) return res.status(404).json({ error: `${Singular} not found` });
      const deleted = data[key].splice(i, 1)[0];
      save(data);
      res.json({ success: true, deleted });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
