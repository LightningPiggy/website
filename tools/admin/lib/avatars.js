// Avatar localisation for the admin server.
//
// Third-party avatar hosts (notably unavatar.io) rate-limit hard — the credits
// page requesting ~50 of them reliably 429s, so a random handful come back
// blank for real visitors. Remote hosts also rot (expiring pbs.twimg.com URLs,
// blossom servers that disappear) and leak every visitor's IP to a dozen
// parties. So each remote avatar is downloaded once, normalised, and served
// from our own /images/profiles/.
//
// Failures are never fatal: the remote URL is kept and the periodic sweep
// retries later (e.g. once a quota resets).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dns from 'node:dns';
import net from 'node:net';
import sharp from 'sharp';

// SSRF guard. We fetch arbitrary operator/RTBD-supplied URLs server-side, so
// block anything resolving to private / loopback / link-local space — the box
// must not become a proxy to internal services or the cloud metadata endpoint.
// Best-effort (a DNS rebind between check and fetch isn't covered), but it
// closes the direct-IP and obvious-hostname cases.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // private
    if (p[0] === 192 && p[1] === 168) return true; // private
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    return false;
  }
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd')) return true;
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped IPv6
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

export async function assertPublicHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  const addrs = await dns.promises.lookup(u.hostname, { all: true });
  if (!addrs.length) throw new Error('Host did not resolve');
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error('URL points to a disallowed (private) address');
  }
}

export const isRemoteAvatar = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

// Wire up the localiser against a credits store.
//   profileDir  — absolute path to public/images/profiles
//   publicPath  — URL prefix the site serves those from
//   fields      — credit fields that may hold an avatar URL
//   load/save   — the credits store accessors (save must NOT re-trigger this,
//                 or the backlog's own write would recurse)
export function createAvatarLocaliser({ profileDir, publicPath = '/images/profiles', fields, load, save }) {
  fs.mkdirSync(profileDir, { recursive: true });

  async function localizeAvatar(url, name) {
    await assertPublicHttpUrl(url);
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 LightningPiggyAdmin' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get('content-type') || '';
    // A rate-limit JSON body would otherwise be written out as "an image".
    if (!type.startsWith('image/')) throw new Error(`not an image (${type || 'unknown type'})`);
    const buf = Buffer.from(await r.arrayBuffer());
    const slug =
      (name || 'credit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) ||
      'credit';
    // Hash the source URL so re-runs are idempotent and a changed source
    // produces a new file rather than silently overwriting the old one.
    const filename = `${slug}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}.jpg`;
    await sharp(buf)
      .resize(400, 400, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85 })
      .toFile(path.join(profileDir, filename));
    return `${publicPath}/${filename}`;
  }

  // Download pending remote avatars and write the local paths back.
  // `creditId` limits it to one credit (used right after a save); omitted, it
  // sweeps the whole backlog up to `limit`.
  async function localizeAvatarBacklog({ creditId = null, limit = 8, pauseMs = 2000 } = {}) {
    const snapshot = load();
    const pending = [];
    for (const c of snapshot.credits) {
      if (creditId && c.id !== creditId) continue;
      for (const f of fields) {
        if (isRemoteAvatar(c[f])) pending.push({ id: c.id, name: c.name, field: f, url: c[f] });
      }
    }
    if (!pending.length) return { pending: 0, localised: 0 };

    const resolved = [];
    const batch = pending.slice(0, limit);
    for (let i = 0; i < batch.length; i++) {
      const p = batch[i];
      try {
        resolved.push({ ...p, local: await localizeAvatar(p.url, p.name) });
      } catch (err) {
        console.error(`[avatars] ${p.name} · ${p.field}: ${err.message}`);
      }
      // Pace requests — these hosts throttle bursts as well as daily totals.
      if (i < batch.length - 1) await new Promise((r) => setTimeout(r, pauseMs));
    }
    if (!resolved.length) return { pending: pending.length, localised: 0 };

    // Re-load before writing: the downloads above take time and a credit may
    // have been edited meanwhile. Only touch the field we resolved, and only
    // if it still holds the exact URL we downloaded.
    const data = load();
    let localised = 0;
    for (const r of resolved) {
      const c = data.credits.find((x) => x.id === r.id);
      if (c && c[r.field] === r.url) {
        c[r.field] = r.local;
        localised++;
      }
    }
    if (localised) save(data);
    return { pending: pending.length, localised };
  }

  // Fire-and-forget after a credit save, so a slow or rate-limited third-party
  // fetch never holds up the request.
  function localizeCreditAvatarsSoon(creditId) {
    setTimeout(() => {
      localizeAvatarBacklog({ creditId, limit: fields.length, pauseMs: 500 })
        .then((r) => {
          if (r.localised) console.log(`[avatars] localised ${r.localised} for new/updated credit`);
        })
        .catch((err) => console.error('[avatars] post-save localise failed:', err.message));
    }, 50);
  }

  // Drains anything still remote — credits that predate this, ones added via
  // the RTBD tool rather than the admin UI, or ones skipped because the host
  // was rate-limiting at the time.
  function startSweep() {
    setTimeout(() => {
      localizeAvatarBacklog().catch(() => {});
    }, 60 * 1000);
    setInterval(() => {
      localizeAvatarBacklog().catch(() => {});
    }, 3 * 60 * 60 * 1000);
  }

  return { localizeAvatar, localizeAvatarBacklog, localizeCreditAvatarsSoon, startSweep };
}
