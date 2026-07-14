import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { SerialPort } from 'serialport';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeJsonAtomic, loadStore, saveStore, crudRouter } from './lib/store.js';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load secrets from a local-only tools/admin/.env file (gitignored). Lets the
// admin server pick up values like LP_ADMIN_SYNC_TOKEN without exporting them in
// the shell or the launcher. Minimal KEY=VALUE parser - no extra dependency.
// Existing process.env values win (so a shell export still overrides the file).
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn('[admin] Could not read .env:', e.message);
  }
})();

const ROOT = path.resolve(__dirname, '..', '..');
const WILD_DIR = path.join(ROOT, 'public', 'images', 'wild');
const SHOWCASE_DIR = path.join(ROOT, 'public', 'images', 'showcase');
const NEWS_DIR = path.join(ROOT, 'src', 'content', 'news');
const CREDITS_FILE = path.join(os.homedir(), '.lightningpiggy', 'credits.json');
const CREDITS_EXPORT_FILE = path.join(ROOT, 'src', 'data', 'credits.json');
const PARTNERS_FILE = path.join(os.homedir(), '.lightningpiggy', 'partners.json');
const PARTNERS_EXPORT_FILE = path.join(ROOT, 'src', 'data', 'partners.json');
const NOSTR_JSON_FILE = path.join(ROOT, 'public', '.well-known', 'nostr.json');
const LOGOS_DIR = path.join(ROOT, 'public', 'images', 'logos');
const TESTIMONIALS_FILE = path.join(os.homedir(), '.lightningpiggy', 'testimonials.json');
const TESTIMONIALS_EXPORT_FILE = path.join(ROOT, 'src', 'data', 'testimonials.json');
const VENDORS_FILE = path.join(os.homedir(), '.lightningpiggy', 'vendors.json');
const VENDORS_EXPORT_FILE = path.join(ROOT, 'src', 'data', 'vendors.json');

// Device screenshot helper from MicroPythonOS/scripts. Override with
// LP_DEVICE_SCREENSHOT_SCRIPT env var if your MicroPythonOS checkout lives elsewhere.
const DEVICE_SCREENSHOT_SCRIPT = process.env.LP_DEVICE_SCREENSHOT_SCRIPT
  || path.join(__dirname, 'device_screenshot.sh');
const DEVICE_SCREENSHOT_FILE = path.join(os.homedir(), '.lightningpiggy', 'device_screenshot.png');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// --- Local-only access control ---------------------------------------------
// The tool has no login, so we defend the two ways a remote page could still
// reach a loopback server:
//   1. DNS-rebinding — blocked by a Host-header allowlist (a rebinding attack
//      arrives with the attacker's hostname in Host, not localhost).
//   2. CSRF — blocked by requiring a custom header on /api. A cross-origin page
//      cannot set X-LP-Admin-Token without a CORS preflight we never approve,
//      and it cannot read the token (it's injected into the same-origin HTML).
const ADMIN_TOKEN =
  (process.env.LP_ADMIN_SYNC_TOKEN && process.env.LP_ADMIN_SYNC_TOKEN.length >= 16)
    ? process.env.LP_ADMIN_SYNC_TOKEN
    : crypto.randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set(['localhost:3000', '127.0.0.1:3000', '[::1]:3000']);
function hostAllowed(req) {
  return ALLOWED_HOSTS.has((req.headers.host || '').toLowerCase());
}

app.use((req, res, next) => {
  if (!hostAllowed(req)) return res.status(403).type('text').send('Forbidden host');
  next();
});

// Token gate on the API. /api/admin/ping stays open as a liveness probe (no
// data) so the .app launcher's readiness check keeps working.
app.use('/api', (req, res, next) => {
  if (req.path === '/admin/ping') return next();
  if (req.get('x-lp-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Serve the UI shell with the token injected so the same-origin app can read it.
function sendIndex(res) {
  try {
    const file = path.join(__dirname, 'public', 'index.html');
    const html = fs.readFileSync(file, 'utf8').replace(
      '</head>',
      `  <meta name="lp-admin-token" content="${ADMIN_TOKEN}">\n</head>`,
    );
    res.type('html').send(html);
  } catch (e) {
    res.status(500).type('text').send('Failed to load admin UI');
  }
}
app.get('/', (req, res) => sendIndex(res));
app.get('/index.html', (req, res) => sendIndex(res));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/branding', express.static(path.join(ROOT, 'public', 'images', 'branding')));
app.use('/images/testimonials', express.static(path.join(ROOT, 'public', 'images', 'testimonials')));
app.use('/images/logos', express.static(path.join(ROOT, 'public', 'images', 'logos')));
app.use(express.json());

// --- Filesystem browsing (for save-folder picker) ---
function expandPath(p) {
  if (!p) return os.homedir();
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1).replace(/^\//, ''));
  return path.resolve(p);
}


// Native macOS folder picker via osascript
app.post('/api/fs/pick-folder', async (req, res) => {
  try {
    if (process.platform !== 'darwin') {
      return res.status(400).json({ error: 'Native folder picker only supported on macOS' });
    }
    // Pass the default path as an argv item rather than interpolating it into
    // the script body, so a value containing a quote can't break out of the
    // AppleScript string and run `do shell script`. Also reject control chars.
    const rawDefault = req.body?.defaultPath ? String(req.body.defaultPath).replace(/^~/, os.homedir()) : '';
    if (rawDefault && /[\r\n"\\]/.test(rawDefault)) {
      return res.status(400).json({ error: 'Invalid defaultPath' });
    }
    const script = `on run argv
  tell application "System Events" to activate
  if (count of argv) > 0 and (item 1 of argv) is not "" then
    return POSIX path of (choose folder with prompt "Select save folder for captures" default location POSIX file (item 1 of argv))
  else
    return POSIX path of (choose folder with prompt "Select save folder for captures")
  end if
end run`;
    const { stdout } = await execFileAsync('osascript', ['-e', script, rawDefault]);
    let folder = stdout.trim().replace(/\/$/, '');
    const home = os.homedir();
    const display = folder === home ? '~' : folder.startsWith(home + '/') ? '~' + folder.slice(home.length) : folder;
    res.json({ path: folder, display });
  } catch (err) {
    // User cancelled - osascript exits with error
    if (err.stderr && err.stderr.includes('User canceled')) {
      return res.status(204).end();
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Admin control ---
// Ping endpoint used by the launcher app to check if the server is running.
app.get('/api/admin/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// --- OG Preview ----------------------------------------------------
// Internal validator that fetches every public URL and parses its OG tags so
// we can see exactly what Facebook/LinkedIn/X will see, without bouncing
// through external validators.
const ASTRO_DEV_URL = 'http://localhost:4321';
const PROD_HOSTNAMES = ['lightningpiggy.com', 'www.lightningpiggy.com'];

function extractMetaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]*?(?:property|name)=["']${key}["'][^>]*?content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*?content=["']([^"']*)["'][^>]*?(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { blocks.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  return blocks;
}

function _toLocalUrl(absUrl) {
  if (!absUrl) return '';
  try {
    const u = new URL(absUrl);
    if (PROD_HOSTNAMES.includes(u.hostname)) {
      return ASTRO_DEV_URL + u.pathname + u.search + u.hash;
    }
    return absUrl;
  } catch {
    return absUrl;
  }
}

function listPreviewablePaths() {
  const paths = [
    { path: '/',                                label: 'Home',              group: 'Main' },
    { path: '/about/',                          label: 'About',             group: 'Main' },
    { path: '/about/origin-story/',             label: 'Origin Story',      group: 'Main' },
    { path: '/donate/',                         label: 'Donate',            group: 'Main' },

    { path: '/build/',                          label: 'Build',             group: 'Build' },
    { path: '/build/classic/',                  label: 'Build Classic',     group: 'Build' },
    { path: '/build/p1/',                       label: 'Build p1',          group: 'Build' },
    { path: '/build/cases/',                    label: 'Cases',             group: 'Build' },
    { path: '/build/lnbits/',                   label: 'LNbits Guide',      group: 'Build' },
    { path: '/build/wifi-qr/',                  label: 'WiFi QR',           group: 'Build' },
    { path: '/build/lnurl-qr/',                 label: 'LNURL QR',          group: 'Build' },

    { path: '/market/',                         label: 'Market',            group: 'Market' },
    { path: '/market/nip05/',                   label: 'NIP-05 Handles',    group: 'Market' },

    { path: '/community/',                      label: 'Community',         group: 'Community' },
    { path: '/community/wild/',                 label: 'In the Wild',       group: 'Community' },
    { path: '/community/educators/',            label: 'Educators',         group: 'Community' },
    { path: '/community/bitcoinkids/',          label: 'Bitcoin Kids',      group: 'Community' },
    { path: '/community/zapmypiggy/',           label: 'ZapMyPiggy',        group: 'Community' },
    { path: '/community/credits/',              label: 'Credits',           group: 'Community' },

    { path: '/help/',                           label: 'Help',              group: 'Help' },
    { path: '/help/troubleshooting/',           label: 'Troubleshooting',   group: 'Help' },
    { path: '/help/serial-monitor/',            label: 'Serial Monitor',    group: 'Help' },
    { path: '/help/faqs/',                      label: 'FAQs',              group: 'Help' },

    { path: '/news/',                           label: 'News',              group: 'News' },
  ];

  // Discover news posts from the content collection
  try {
    const newsDir = path.join(ROOT, 'src', 'content', 'news');
    for (const entry of fs.readdirSync(newsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(newsDir, entry.name, 'index.md');
      if (fs.existsSync(indexPath)) {
        paths.push({
          path: `/news/${entry.name}/`,
          label: entry.name.replace(/-/g, ' '),
          group: 'News',
        });
      }
    }
  } catch (err) {
    console.error('og-preview: failed to enumerate news:', err.message);
  }

  return paths;
}

async function fetchOgInfo(absUrl) {
  try {
    const res = await fetch(absUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const html = await res.text();
    const ogImage = extractMetaContent(html, 'og:image');
    const localImage = _toLocalUrl(ogImage);
    const result = {
      ok: true,
      status: res.status,
      title: extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || '',
      description: extractMetaContent(html, 'og:description') || extractMetaContent(html, 'twitter:description') || '',
      image: ogImage,
      displayImage: localImage,
      imageAlt: extractMetaContent(html, 'og:image:alt') || '',
      type: extractMetaContent(html, 'og:type') || 'website',
      siteName: extractMetaContent(html, 'og:site_name') || '',
      twitterCard: extractMetaContent(html, 'twitter:card') || '',
      jsonLd: extractJsonLdBlocks(html),
    };

    if (localImage) {
      try {
        const head = await fetch(localImage, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
        result.imageStatus = head.status;
        result.imageOk = head.ok;
      } catch {
        result.imageStatus = 0;
        result.imageOk = false;
      }
    }

    if (ogImage && ogImage !== localImage) {
      try {
        const head = await fetch(ogImage, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
        result.liveImageStatus = head.status;
        result.liveImageOk = head.ok;
        const lenHeader = head.headers.get('content-length');
        if (lenHeader) result.liveImageBytes = parseInt(lenHeader, 10);
      } catch {
        result.liveImageStatus = 0;
        result.liveImageOk = false;
      }
    }

    if (localImage) {
      try {
        const localPath = new URL(localImage).pathname;
        const fsPath = path.join(ROOT, 'public', localPath.replace(/^\//, ''));
        if (fs.existsSync(fsPath)) {
          result.localImageBytes = fs.statSync(fsPath).size;
        }
      } catch { /* ignore */ }
    }

    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

app.get('/api/og-preview', async (req, res) => {
  try {
    const paths = listPreviewablePaths();
    const results = await Promise.all(paths.map(async (p) => ({
      ...p,
      url: ASTRO_DEV_URL + p.path,
      og: await fetchOgInfo(ASTRO_DEV_URL + p.path),
    })));
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Deploy (direct to Netlify - no git, no GitHub) ---
//
// Git-based deploy/sync was removed on purpose: the admin tool must never
// reach GitHub. Instead we build the site locally and upload dist/ straight
// to Netlify with the CLI (uses your `netlify login` session and the site
// link in .netlify/state.json).
//
// Caveat: anything published this way that is NOT also committed to the repo
// will be reverted the next time a git push triggers a Netlify build.

let deployRunning = false;

app.post('/api/deploy/netlify', async (req, res) => {
  if (deployRunning) {
    return res.status(409).json({ error: 'A deploy is already in progress' });
  }
  deployRunning = true;
  const log = [];
  // Homebrew binaries (node/npm/netlify) aren't on execFile's stripped PATH.
  const env = {
    ...process.env,
    PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':'),
  };
  const run = async (cmd, args, label) => {
    log.push('$ ' + label);
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: ROOT, env, maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000,
    });
    if (stdout) log.push(stdout.toString().trim());
    if (stderr) log.push(stderr.toString().trim());
    return stdout.toString();
  };
  try {
    await run('npm', ['run', 'build'], 'npm run build');
    const message = ((req.body || {}).message || 'Admin tool deploy').toString().slice(0, 200);
    const out = await run(
      'netlify',
      ['deploy', '--prod', '--dir', 'dist', '--message', message, '--json'],
      `netlify deploy --prod --dir dist --message "${message}"`,
    );
    let deployUrl = null;
    try { deployUrl = JSON.parse(out).url || JSON.parse(out).deploy_url || null; } catch {}
    res.json({ success: true, url: deployUrl, output: log.join('\n') });
  } catch (err) {
    log.push('ERROR: ' + err.message);
    if (err.stdout) log.push(err.stdout.toString().trim());
    if (err.stderr) log.push(err.stderr.toString().trim());
    res.status(500).json({ error: err.message, output: log.join('\n') });
  } finally {
    deployRunning = false;
  }
});

app.get('/api/fs/ls', (req, res) => {
  try {
    const reqPath = (req.query.path || '~').toString();
    const abs = expandPath(reqPath);
    const home = os.homedir();
    // Confine the browser to the home directory; this is only used to pick a
    // capture-save folder, and expandPath would otherwise resolve to anywhere.
    if (abs !== home && !abs.startsWith(home + path.sep)) {
      return res.status(400).json({ error: 'Path must be inside the home directory' });
    }
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    const display = abs === home ? '~' : abs.startsWith(home + '/') ? '~' + abs.slice(home.length) : abs;
    // Don't offer a parent link above home.
    const parent = abs === home ? abs : path.dirname(abs);
    const parentDisplay = parent === home ? '~' : parent.startsWith(home + '/') ? '~' + parent.slice(home.length) : parent;
    res.json({
      path: abs,
      display,
      parent: parent === abs ? null : parentDisplay,
      folders: entries,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Wild Photo Endpoints ---

app.get('/api/wild/next-number', (req, res) => {
  const files = fs.readdirSync(WILD_DIR).filter(f => /^wild-\d+\.\w+$/.test(f));
  const numbers = files.map(f => parseInt(f.match(/wild-(\d+)/)[1], 10));
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  res.json({ next, padded: String(next).padStart(3, '0') });
});

app.post('/api/wild/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    // Get next number
    const files = fs.readdirSync(WILD_DIR).filter(f => /^wild-\d+\.\w+$/.test(f));
    const numbers = files.map(f => parseInt(f.match(/wild-(\d+)/)[1], 10));
    const next = numbers.length ? Math.max(...numbers) + 1 : 1;
    const filename = `wild-${String(next).padStart(3, '0')}.jpeg`;
    const outputPath = path.join(WILD_DIR, filename);

    // Optimize image
    await sharp(req.file.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      filename,
      size: `${Math.round(stats.size / 1024)}KB`,
      path: `/images/wild/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Wild Gallery Endpoints ---

app.get('/api/wild/list', (req, res) => {
  const files = fs.readdirSync(WILD_DIR)
    .filter(f => /^wild-\d+\.\w+$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/wild-(\d+)/)[1], 10);
      const numB = parseInt(b.match(/wild-(\d+)/)[1], 10);
      return numB - numA;
    });
  const images = files.map(f => {
    const stats = fs.statSync(path.join(WILD_DIR, f));
    return { filename: f, path: `/images/wild/${f}`, size: `${Math.round(stats.size / 1024)}KB`, modified: stats.mtime.toISOString() };
  });
  res.json(images);
});

app.delete('/api/wild/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^wild-\d+\.\w+$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(WILD_DIR, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filepath);
  res.json({ success: true, deleted: filename });
});

app.use('/images/wild', express.static(WILD_DIR));

// --- Showcase Photo Endpoints ---

app.post('/api/showcase/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const files = fs.readdirSync(SHOWCASE_DIR).filter(f => /^showcase-\d+\.\w+$/.test(f));
    const numbers = files.map(f => parseInt(f.match(/showcase-(\d+)/)[1], 10));
    const next = numbers.length ? Math.max(...numbers) + 1 : 1;
    const filename = `showcase-${String(next).padStart(3, '0')}.jpeg`;
    const outputPath = path.join(SHOWCASE_DIR, filename);

    await sharp(req.file.buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      filename,
      size: `${Math.round(stats.size / 1024)}KB`,
      path: `/images/showcase/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Showcase Gallery Endpoints ---

app.get('/api/showcase/list', (req, res) => {
  const files = fs.readdirSync(SHOWCASE_DIR)
    .filter(f => /^showcase-\d+\.\w+$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/showcase-(\d+)/)[1], 10);
      const numB = parseInt(b.match(/showcase-(\d+)/)[1], 10);
      return numB - numA; // newest first
    });
  const images = files.map(f => {
    const stats = fs.statSync(path.join(SHOWCASE_DIR, f));
    return { filename: f, path: `/images/showcase/${f}`, size: `${Math.round(stats.size / 1024)}KB` };
  });
  res.json(images);
});

app.delete('/api/showcase/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^showcase-\d+\.\w+$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filepath = path.join(SHOWCASE_DIR, filename);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  fs.unlinkSync(filepath);
  res.json({ success: true, deleted: filename });
});

// Serve showcase images for the admin gallery
app.use('/images/showcase', express.static(SHOWCASE_DIR));

// --- News Post Endpoints ---

// Minimal frontmatter parser for news index.md files (supports the keys the
// publisher writes: title, slug, description, pubDate, heroImage, tags, category, url).
function parseNewsFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: md };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    data[key] = val;
  }
  return { data, content: m[2].replace(/^\r?\n/, '') };
}

// Publish a new news post OR update an existing one (when originalSlug is sent).
app.post('/api/news/publish', upload.single('heroImage'), async (req, res) => {
  try {
    const { title, slug, description, pubDate, tags, content, category, url, originalSlug } = req.body;

    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Title, slug, and content are required' });
    }

    // Slugs are used as directory names, so constrain them to a safe charset and
    // reject any path-traversal attempt (e.g. "../../etc") before touching disk.
    const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
    const trimmedOriginal = originalSlug && originalSlug.trim();
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug: use lowercase letters, numbers and hyphens only' });
    }
    if (trimmedOriginal && !SLUG_RE.test(trimmedOriginal)) {
      return res.status(400).json({ error: 'Invalid original slug' });
    }

    const isEdit = !!trimmedOriginal;
    const postDir = path.join(NEWS_DIR, slug);
    const originalDir = isEdit ? path.join(NEWS_DIR, trimmedOriginal) : null;

    // Defense in depth: confirm the resolved paths stay inside NEWS_DIR.
    for (const dir of [postDir, originalDir]) {
      if (dir && !path.resolve(dir).startsWith(path.resolve(NEWS_DIR) + path.sep)) {
        return res.status(400).json({ error: 'Resolved path escapes the news directory' });
      }
    }

    // In edit mode, read the existing frontmatter so we can preserve the hero
    // image and tags when the form doesn't supply new ones.
    let existingData = {};
    if (isEdit && originalDir && fs.existsSync(path.join(originalDir, 'index.md'))) {
      existingData = parseNewsFrontmatter(fs.readFileSync(path.join(originalDir, 'index.md'), 'utf-8')).data;
    }

    if (isEdit) {
      // Renaming onto a slug owned by a different post is not allowed.
      if (slug !== originalSlug.trim() && fs.existsSync(postDir)) {
        return res.status(400).json({ error: `Another news post "${slug}" already exists` });
      }
      // Move the existing directory if the slug changed.
      if (slug !== originalSlug.trim() && originalDir && fs.existsSync(originalDir)) {
        fs.renameSync(originalDir, postDir);
      }
      if (!fs.existsSync(postDir)) fs.mkdirSync(postDir, { recursive: true });
    } else {
      if (fs.existsSync(postDir)) {
        return res.status(400).json({ error: `News post "${slug}" already exists` });
      }
      fs.mkdirSync(postDir, { recursive: true });
    }

    // Hero image: a new upload replaces it; otherwise keep whatever the post had.
    let heroValue = '';
    if (req.file) {
      await sharp(req.file.buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(path.join(postDir, 'hero.jpeg'));
      heroValue = './hero.jpeg';
    } else if (isEdit && existingData.heroImage) {
      heroValue = existingData.heroImage; // preserve existing hero
    }

    // Tags: use the submitted list, else preserve existing tags on edit.
    let tagsList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    if (!tagsList.length && isEdit && Array.isArray(existingData.tags)) {
      tagsList = existingData.tags;
    }

    // Build frontmatter
    let frontmatter = `---\ntitle: "${title}"\nslug: ${slug}\n`;
    if (description) frontmatter += `description: "${description}"\n`;
    frontmatter += `pubDate: ${pubDate || new Date().toISOString().split('T')[0]}\n`;
    if (heroValue) frontmatter += `heroImage: '${heroValue}'\n`;
    if (tagsList.length) frontmatter += `tags: [${tagsList.map(t => `"${t}"`).join(', ')}]\n`;
    if (category) frontmatter += `category: ${category}\n`;
    if (url) frontmatter += `url: "${url}"\n`;
    frontmatter += `---\n\n`;

    fs.writeFileSync(path.join(postDir, 'index.md'), frontmatter + content);

    res.json({ success: true, slug, path: `/news/${slug}`, updated: isEdit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List existing news posts (for the admin edit picker)
app.get('/api/news', (req, res) => {
  try {
    const posts = [];
    if (fs.existsSync(NEWS_DIR)) {
      for (const entry of fs.readdirSync(NEWS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const indexPath = path.join(NEWS_DIR, entry.name, 'index.md');
        if (!fs.existsSync(indexPath)) continue;
        const { data } = parseNewsFrontmatter(fs.readFileSync(indexPath, 'utf-8'));
        posts.push({
          slug: entry.name,
          title: data.title || entry.name,
          category: data.category || '',
          pubDate: data.pubDate || '',
        });
      }
    }
    posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
    res.json({ posts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a single news post for editing
app.get('/api/news/:slug', (req, res) => {
  try {
    const indexPath = path.join(NEWS_DIR, req.params.slug, 'index.md');
    if (!fs.existsSync(indexPath)) return res.status(404).json({ error: 'News post not found' });
    const { data, content } = parseNewsFrontmatter(fs.readFileSync(indexPath, 'utf-8'));
    res.json({
      slug: req.params.slug,
      title: data.title || '',
      description: data.description || '',
      pubDate: data.pubDate || '',
      tags: Array.isArray(data.tags) ? data.tags.join(', ') : (data.tags || ''),
      category: data.category || '',
      url: data.url || '',
      content,
      hasHero: !!data.heroImage,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Nostr Profile Lookup ---

app.get('/api/nostr/profile/:hex', async (req, res) => {
  const hex = req.params.hex;
  if (!hex || hex.length !== 64) {
    return res.status(400).json({ error: 'Invalid hex pubkey' });
  }

  try {
    const profile = await fetchNostrProfile(hex);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function fetchNostrProfile(hex) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://cache2.primal.net/v1');
    const subId = crypto.randomUUID().slice(0, 8);
    let profile = null;
    let timeout;

    ws.on('open', () => {
      // Request user profile metadata
      ws.send(JSON.stringify(['REQ', subId, { cache: ['user_profile', { pubkey: hex }] }]));
      timeout = setTimeout(() => {
        ws.close();
        resolve({ picture: '', name: '', about: '' });
      }, 5000);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]?.kind === 0) {
          const content = JSON.parse(msg[2].content);
          profile = {
            picture: content.picture || '',
            name: content.name || content.display_name || '',
            about: content.about || '',
          };
        }
        if (msg[0] === 'EOSE') {
          clearTimeout(timeout);
          ws.close();
          resolve(profile || { picture: '', name: '', about: '' });
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!profile) resolve({ picture: '', name: '', about: '' });
    });
  });
}

// --- Credits Endpoints ---

function loadCredits() {
  return loadStore(CREDITS_FILE, 'credits');
}

function saveCredits(data) {
  saveStore(CREDITS_FILE, data);
  // Auto-sync the website export after every change so src/data/credits.json
  // stays current without a manual "Sync to Website" step. (git push still
  // publishes.) A sync failure must not break the save.
  try {
    syncCreditsToWebsite();
  } catch (err) {
    console.error('[credits] auto-sync failed:', err.message);
  }
}

// A credit can belong to several website sections. Accept the new
// `websiteSections` array, but fall back to the legacy single `websiteSection`
// (+ `isBitcoinKid` flag) so older clients/data keep working.
function normaliseSections(body) {
  if (Array.isArray(body.websiteSections)) return body.websiteSections.filter(Boolean);
  const out = [];
  if (body.websiteSection) out.push(body.websiteSection);
  if (body.isBitcoinKid === true || body.isBitcoinKid === 'true') out.push('Bitcoin Kids');
  return out;
}

// GET / POST / PUT reorder / PUT :id / DELETE :id — the logo + sync routes for
// credits are registered separately below.
app.use('/api/credits', crudRouter({
  load: loadCredits,
  save: saveCredits,
  key: 'credits',
  singular: 'credit',
  build: (b) => ({
    name: b.name || '',
    email: b.email || '',
    role: b.role || '',
    lightningAddress: b.lightningAddress || '',
    nostrNpub: b.nostrNpub || '',
    nostrHex: b.nostrHex || '',
    nostrProfilePic: b.nostrProfilePic || '',
    xProfileUrl: b.xProfileUrl || '',
    xProfilePic: b.xProfilePic || '',
    websiteUrl: b.websiteUrl || '',
    githubUrl: b.githubUrl || '',
    description: b.description || '',
    logoUrl: b.logoUrl || '',
    notes: b.notes || '',
    showOnWebsite: b.showOnWebsite ?? false,
    websiteSections: normaliseSections(b),
    dateAdded: b.dateAdded || new Date().toISOString().split('T')[0],
  }),
  merge: (existing, b) => {
    const updated = {
      ...existing,
      name: b.name ?? existing.name,
      email: b.email ?? existing.email,
      role: b.role ?? existing.role,
      lightningAddress: b.lightningAddress ?? existing.lightningAddress,
      nostrNpub: b.nostrNpub ?? existing.nostrNpub,
      nostrHex: b.nostrHex ?? existing.nostrHex,
      nostrProfilePic: b.nostrProfilePic ?? existing.nostrProfilePic,
      xProfileUrl: b.xProfileUrl ?? existing.xProfileUrl,
      xProfilePic: b.xProfilePic ?? existing.xProfilePic,
      websiteUrl: b.websiteUrl ?? existing.websiteUrl ?? '',
      githubUrl: b.githubUrl ?? existing.githubUrl ?? '',
      description: b.description ?? existing.description ?? '',
      logoUrl: b.logoUrl ?? existing.logoUrl ?? '',
      notes: b.notes ?? existing.notes,
      showOnWebsite: b.showOnWebsite ?? existing.showOnWebsite ?? false,
      websiteSections: Array.isArray(b.websiteSections)
        ? b.websiteSections.filter(Boolean)
        : (existing.websiteSections || normaliseSections(existing)),
    };
    delete updated.websiteSection;
    delete updated.isBitcoinKid;
    return updated;
  },
}));

// Upload a logo for a credit (200x200 PNG, same pipeline as partners/vendors)
app.post('/api/credits/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
    const name = req.body.name || `logo-${Date.now()}`;
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${safeName}.png`;
    const outputPath = path.join(LOGOS_DIR, filename);
    await sharp(req.file.buffer)
      .resize({ width: 200, height: 200, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90 })
      .toFile(outputPath);
    const stats = fs.statSync(outputPath);
    res.json({ success: true, filename, size: `${Math.round(stats.size / 1024)}KB`, path: `/images/logos/${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync credits to website (export only showOnWebsite: true entries)
// Regenerate src/data/credits.json from the credit store. Runs automatically
// after every credit change (add/edit/delete/reorder) and is also exposed via
// the endpoint below. Returns the exported per-section counts.
function syncCreditsToWebsite() {
    const data = loadCredits();

    // Export every on-website credit that has a section assigned. Credits-page
    // sections (Core Team / Contributor / Special Thanks) and landing-page
    // sections (Community Supporters / Education Partners / Enabling Technologies /
    // Appearances / In the News) are both supported - the landing-page ones are
    // emitted in the same shape as partners so FriendsFamily.astro can merge them.
    // A credit can be in several sections at once (websiteSections array).
    const secs = (c) => Array.isArray(c.websiteSections) ? c.websiteSections : normaliseSections(c);
    const has = (c, section) => secs(c).includes(section);
    const websiteCredits = data.credits.filter(c => c.showOnWebsite && secs(c).length);

    // Helper to build a credits-page object (Core Team / Contributors / Bitcoin Kids).
    const buildCreditObj = (c, includeContribution = true, includeNote = false) => {
      const nostrUrl = c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : '';
      const xUrl = c.xProfileUrl || '';
      const primaryUrl = (c.websiteUrl || '') || nostrUrl || xUrl;
      const obj = {
        name: c.name,
        url: primaryUrl,
        avatar: c.logoUrl || c.nostrProfilePic || c.xProfilePic || '',
        isBitcoinKid: has(c, 'Bitcoin Kids'),
        nostrUrl,
        xUrl,
        githubUrl: c.githubUrl || '',
      };
      if (includeContribution) obj.contribution = c.notes || '';
      if (includeNote) obj.note = c.notes || '';
      return obj;
    };

    // Landing-page sections expect the partner shape (name/description/url/logo
    // + social URLs) so FriendsFamily.astro can render them.
    const buildPartnerLikeObj = (c) => {
      const nostrUrl = c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : '';
      const xUrl = c.xProfileUrl || '';
      return {
        name: c.name,
        description: c.description || c.notes || '',
        url: (c.websiteUrl || '') || nostrUrl || xUrl,
        logo: c.logoUrl || c.nostrProfilePic || c.xProfilePic || '',
        nostrUrl,
        xUrl,
        githubUrl: c.githubUrl || '',
      };
    };
    const landingGroup = (section) => websiteCredits.filter(c => has(c, section)).map(buildPartnerLikeObj);

    // Group by section. Bitcoin Kids are emitted as their own group and pulled
    // out of Core Team / Contributors (mirroring the public credits page).
    const grouped = {
      coreTeam: websiteCredits
        .filter(c => has(c, 'Core Team') && !has(c, 'Bitcoin Kids'))
        .map(c => buildCreditObj(c, true, false)),
      contributors: websiteCredits
        .filter(c => (has(c, 'Contributor') || has(c, 'Special Thanks')) && !has(c, 'Bitcoin Kids'))
        .map(c => buildCreditObj(c, has(c, 'Contributor'), !has(c, 'Contributor') && has(c, 'Special Thanks'))),
      specialThanks: [], // merged into contributors; kept for backwards compatibility
      bitcoinKids: websiteCredits
        .filter(c => has(c, 'Bitcoin Kids'))
        .map(c => buildCreditObj(c, true, false)),
      communitySupporters: landingGroup('Community Supporters'),
      educationPartners: landingGroup('Education Partners'),
      technologyPartners: landingGroup('Enabling Technologies'),
      appearances: landingGroup('Appearances'),
      inTheNews: landingGroup('In the News'),
    };

    // Ensure data directory exists
    const exportDir = path.dirname(CREDITS_EXPORT_FILE);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    // Write to website data file
    writeJsonAtomic(CREDITS_EXPORT_FILE, grouped);

    return {
      coreTeam: grouped.coreTeam.length,
      contributors: grouped.contributors.length,
      specialThanks: grouped.specialThanks.length,
      bitcoinKids: grouped.bitcoinKids.length,
      communitySupporters: grouped.communitySupporters.length,
      educationPartners: grouped.educationPartners.length,
      technologyPartners: grouped.technologyPartners.length,
      appearances: grouped.appearances.length,
      inTheNews: grouped.inTheNews.length,
    };
}

app.post('/api/credits/sync', (req, res) => {
  try {
    const exported = syncCreditsToWebsite();
    res.json({ success: true, exported, path: 'src/data/credits.json' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Partners Endpoints ---

function loadPartners() {
  return loadStore(PARTNERS_FILE, 'partners');
}

// Partners intentionally have no auto-sync; the website export is written only
// via the explicit POST /api/partners/sync route.
function savePartners(data) {
  saveStore(PARTNERS_FILE, data);
}

// GET / POST / PUT reorder / PUT :id / DELETE :id — the sync + logo routes for
// partners are registered separately below.
app.use('/api/partners', crudRouter({
  load: loadPartners,
  save: savePartners,
  key: 'partners',
  singular: 'partner',
  build: (b) => ({
    name: b.name || '',
    description: b.description || '',
    websiteUrl: b.websiteUrl || '',
    logoUrl: b.logoUrl || '',
    nostrNpub: b.nostrNpub || '',
    nostrProfilePic: b.nostrProfilePic || '',
    xProfileUrl: b.xProfileUrl || '',
    xProfilePic: b.xProfilePic || '',
    githubUrl: b.githubUrl || '',
    section: b.section || '',
    showOnWebsite: b.showOnWebsite ?? false,
    dateAdded: b.dateAdded || new Date().toISOString().split('T')[0],
  }),
  merge: (existing, b) => ({
    ...existing,
    name: b.name ?? existing.name,
    description: b.description ?? existing.description,
    websiteUrl: b.websiteUrl ?? existing.websiteUrl,
    logoUrl: b.logoUrl ?? existing.logoUrl,
    nostrNpub: b.nostrNpub ?? existing.nostrNpub,
    nostrProfilePic: b.nostrProfilePic ?? existing.nostrProfilePic,
    xProfileUrl: b.xProfileUrl ?? existing.xProfileUrl,
    xProfilePic: b.xProfilePic ?? existing.xProfilePic,
    githubUrl: b.githubUrl ?? existing.githubUrl ?? '',
    section: b.section ?? existing.section,
    showOnWebsite: b.showOnWebsite ?? existing.showOnWebsite,
  }),
}));

// Sync partners to website
app.post('/api/partners/sync', (req, res) => {
  try {
    const data = loadPartners();

    // Filter partners that should appear on website
    const websitePartners = data.partners.filter(p => p.showOnWebsite);

    // Helper to build partner object
    const buildPartnerObj = (p) => {
      const nostrUrl = p.nostrNpub ? `https://njump.me/${p.nostrNpub}` : '';
      const xUrl = p.xProfileUrl || '';
      const websiteUrl = p.websiteUrl || '';
      const githubUrl = p.githubUrl || '';
      const primaryUrl = websiteUrl || nostrUrl || xUrl;

      return {
        name: p.name,
        description: p.description || '',
        url: primaryUrl,
        logo: p.logoUrl || p.nostrProfilePic || p.xProfilePic || '',
        nostrUrl: nostrUrl,
        xUrl: xUrl,
        githubUrl: githubUrl,
      };
    };

    // Group by section
    const grouped = {
      communitySponsors: websitePartners
        .filter(p => p.section === 'Community Sponsors')
        .map(buildPartnerObj),
      educationPartners: websitePartners
        .filter(p => p.section === 'Education Partners')
        .map(buildPartnerObj),
      technologyPartners: websitePartners
        .filter(p => p.section === 'Enabling Technologies')
        .map(buildPartnerObj),
      appearances: websitePartners
        .filter(p => p.section === 'Appearances')
        .map(buildPartnerObj),
      inTheNews: websitePartners
        .filter(p => p.section === 'In the News')
        .map(buildPartnerObj),
    };

    // Ensure data directory exists
    const exportDir = path.dirname(PARTNERS_EXPORT_FILE);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    // Write to website data file
    writeJsonAtomic(PARTNERS_EXPORT_FILE, grouped);

    res.json({
      success: true,
      exported: {
        communitySponsors: grouped.communitySponsors.length,
        educationPartners: grouped.educationPartners.length,
        technologyPartners: grouped.technologyPartners.length,
        appearances: grouped.appearances.length,
        inTheNews: grouped.inTheNews.length,
      },
      path: 'src/data/partners.json',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload partner logo
app.post('/api/partners/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    // Ensure logos directory exists
    if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });

    // Generate filename from partner name or use timestamp
    const name = req.body.name || `logo-${Date.now()}`;
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${safeName}.png`;
    const outputPath = path.join(LOGOS_DIR, filename);

    // Optimize image: resize to 200x200, PNG for transparency support
    await sharp(req.file.buffer)
      .resize({ width: 200, height: 200, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      filename,
      size: `${Math.round(stats.size / 1024)}KB`,
      path: `/images/logos/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- NIP-05 Endpoints ---

function loadNostrJson() {
  try {
    if (!fs.existsSync(NOSTR_JSON_FILE)) {
      const dir = path.dirname(NOSTR_JSON_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeJsonAtomic(NOSTR_JSON_FILE, { names: {}, relays: {} });
    }
    return JSON.parse(fs.readFileSync(NOSTR_JSON_FILE, 'utf-8'));
  } catch (err) {
    return { names: {}, relays: {} };
  }
}

function saveNostrJson(data) {
  const dir = path.dirname(NOSTR_JSON_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJsonAtomic(NOSTR_JSON_FILE, data);
}

// Get all NIP-05 entries
app.get('/api/nip05', (req, res) => {
  const data = loadNostrJson();
  // Convert to array format for easier frontend handling
  const entries = Object.entries(data.names).map(([name, hex]) => ({
    name,
    hex,
    relays: data.relays[hex] || [],
  }));
  res.json(entries);
});

// Add a new NIP-05 entry
app.post('/api/nip05', (req, res) => {
  try {
    const { name, hex, relays } = req.body;
    if (!name || !hex) {
      return res.status(400).json({ error: 'Name and hex are required' });
    }
    // Validate name format (lowercase, no spaces)
    if (!/^[a-z0-9_-]+$/.test(name)) {
      return res.status(400).json({ error: 'Name must be lowercase letters, numbers, underscores and hyphens only' });
    }
    // Validate hex format
    if (!/^[a-f0-9]{64}$/.test(hex)) {
      return res.status(400).json({ error: 'Invalid hex pubkey (must be 64 hex characters)' });
    }

    const data = loadNostrJson();
    if (data.names[name]) {
      return res.status(400).json({ error: `Name "${name}" already exists` });
    }

    data.names[name] = hex;
    if (relays && relays.length > 0) {
      data.relays[hex] = relays;
    }
    saveNostrJson(data);

    res.json({ success: true, entry: { name, hex, relays: relays || [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a NIP-05 entry
app.put('/api/nip05/:name', (req, res) => {
  try {
    const oldName = req.params.name;
    const { name: newName, hex, relays } = req.body;

    const data = loadNostrJson();
    if (!data.names[oldName]) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Validate new name format if changed
    if (newName && !/^[a-z0-9_-]+$/.test(newName)) {
      return res.status(400).json({ error: 'Name must be lowercase letters, numbers, underscores and hyphens only' });
    }
    // Validate hex format
    if (hex && !/^[a-f0-9]{64}$/.test(hex)) {
      return res.status(400).json({ error: 'Invalid hex pubkey (must be 64 hex characters)' });
    }

    const oldHex = data.names[oldName];
    const finalName = newName || oldName;
    const finalHex = hex || oldHex;

    // If name changed, check for conflict
    if (finalName !== oldName && data.names[finalName]) {
      return res.status(400).json({ error: `Name "${finalName}" already exists` });
    }

    // Remove old entry
    delete data.names[oldName];
    // Remove old relays if hex changed
    if (finalHex !== oldHex && data.relays[oldHex]) {
      delete data.relays[oldHex];
    }

    // Add updated entry
    data.names[finalName] = finalHex;
    if (relays && relays.length > 0) {
      data.relays[finalHex] = relays;
    } else if (data.relays[finalHex]) {
      delete data.relays[finalHex];
    }

    saveNostrJson(data);
    res.json({ success: true, entry: { name: finalName, hex: finalHex, relays: relays || [] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a NIP-05 entry
app.delete('/api/nip05/:name', (req, res) => {
  try {
    const data = loadNostrJson();
    const name = req.params.name;

    if (!data.names[name]) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    const hex = data.names[name];
    delete data.names[name];
    if (data.relays[hex]) {
      delete data.relays[hex];
    }

    saveNostrJson(data);
    res.json({ success: true, deleted: { name, hex } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Testimonials Endpoints ---

function loadTestimonials() {
  return loadStore(TESTIMONIALS_FILE, 'testimonials');
}

function saveTestimonials(data) {
  saveStore(TESTIMONIALS_FILE, data);
  // Auto-sync the website export after every change (git push publishes).
  try {
    syncTestimonialsToWebsite();
  } catch (err) {
    console.error('[testimonials] auto-sync failed:', err.message);
  }
}

// GET / POST / PUT reorder / PUT :id / DELETE :id — the upload-profile + sync
// routes for testimonials are registered separately below.
app.use('/api/testimonials', crudRouter({
  load: loadTestimonials,
  save: saveTestimonials,
  key: 'testimonials',
  singular: 'testimonial',
  build: (b) => ({
    name: b.name || '',
    nostrNpub: b.nostrNpub || '',
    profilePic: b.profilePic || '',
    quote: b.quote || '',
    sourcePlatform: b.sourcePlatform || 'other',
    sourceUrl: b.sourceUrl || '',
    showOnWebsite: b.showOnWebsite ?? true,
    dateAdded: b.dateAdded || new Date().toISOString().split('T')[0],
  }),
  merge: (existing, b) => ({
    ...existing,
    name: b.name ?? existing.name,
    nostrNpub: b.nostrNpub ?? existing.nostrNpub,
    profilePic: b.profilePic ?? existing.profilePic,
    quote: b.quote ?? existing.quote,
    sourcePlatform: b.sourcePlatform ?? existing.sourcePlatform,
    sourceUrl: b.sourceUrl ?? existing.sourceUrl,
    showOnWebsite: b.showOnWebsite ?? existing.showOnWebsite,
  }),
}));

// Upload testimonial profile picture
const TESTIMONIALS_IMAGES_DIR = path.join(ROOT, 'public', 'images', 'testimonials');

app.post('/api/testimonials/upload-profile', upload.single('profilePic'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    // Ensure testimonials images directory exists
    if (!fs.existsSync(TESTIMONIALS_IMAGES_DIR)) {
      fs.mkdirSync(TESTIMONIALS_IMAGES_DIR, { recursive: true });
    }

    // Generate filename from testimonialId or create new UUID
    const testimonialId = req.body.testimonialId || crypto.randomUUID();
    const filename = `${testimonialId}.png`;
    const outputPath = path.join(TESTIMONIALS_IMAGES_DIR, filename);

    // Optimize image: resize to 200x200, PNG for transparency support
    await sharp(req.file.buffer)
      .resize({ width: 200, height: 200, fit: 'cover' })
      .png({ quality: 90 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      filename,
      size: `${Math.round(stats.size / 1024)}KB`,
      profilePic: `/images/testimonials/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync testimonials to website
// Regenerate src/data/testimonials.json from the store. Runs automatically
// after every testimonial change, and is exposed via the endpoint below.
function syncTestimonialsToWebsite() {
  const data = loadTestimonials();
  const websiteTestimonials = data.testimonials
    .filter(t => t.showOnWebsite)
    .map(t => ({
      name: t.name,
      profilePic: t.profilePic || '',
      quote: t.quote,
      sourcePlatform: t.sourcePlatform,
      sourceUrl: t.sourceUrl,
    }));
  const exportDir = path.dirname(TESTIMONIALS_EXPORT_FILE);
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  writeJsonAtomic(TESTIMONIALS_EXPORT_FILE, { testimonials: websiteTestimonials });
  return websiteTestimonials.length;
}

app.post('/api/testimonials/sync', (req, res) => {
  try {
    const exported = syncTestimonialsToWebsite();
    res.json({ success: true, exported, path: 'src/data/testimonials.json' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Vendors Endpoints ---

function loadVendors() {
  return loadStore(VENDORS_FILE, 'vendors');
}

function saveVendors(data) {
  saveStore(VENDORS_FILE, data);
  // Auto-sync the website export after every change (git push publishes).
  try {
    syncVendorsToWebsite();
  } catch (err) {
    console.error('[vendors] auto-sync failed:', err.message);
  }
}

// GET / POST / PUT reorder / PUT :id / DELETE :id — the logo, sync and
// submissions routes for vendors are registered separately below.
app.use('/api/vendors', crudRouter({
  load: loadVendors,
  save: saveVendors,
  key: 'vendors',
  singular: 'vendor',
  build: (b) => ({
    name: b.name || '',
    country: b.country || '',
    shippingRegions: b.shippingRegions || [],
    shopType: b.shopType || 'online',
    description: b.description || '',
    websiteUrl: b.websiteUrl || '',
    nostrNpub: b.nostrNpub || '',
    nostrProfilePic: b.nostrProfilePic || '',
    xProfileUrl: b.xProfileUrl || '',
    xProfilePic: b.xProfilePic || '',
    logoUrl: b.logoUrl || '',
    showOnWebsite: b.showOnWebsite ?? true,
    featured: b.featured ?? false,
    dateAdded: b.dateAdded || new Date().toISOString().split('T')[0],
  }),
  merge: (existing, b) => ({
    ...existing,
    name: b.name ?? existing.name,
    country: b.country ?? existing.country,
    shippingRegions: b.shippingRegions ?? existing.shippingRegions,
    shopType: b.shopType ?? existing.shopType,
    description: b.description ?? existing.description,
    websiteUrl: b.websiteUrl ?? existing.websiteUrl,
    nostrNpub: b.nostrNpub ?? existing.nostrNpub,
    nostrProfilePic: b.nostrProfilePic ?? existing.nostrProfilePic,
    xProfileUrl: b.xProfileUrl ?? existing.xProfileUrl,
    xProfilePic: b.xProfilePic ?? existing.xProfilePic,
    logoUrl: b.logoUrl ?? existing.logoUrl,
    showOnWebsite: b.showOnWebsite ?? existing.showOnWebsite,
    featured: b.featured ?? existing.featured ?? false,
  }),
}));

// Upload vendor logo
app.post('/api/vendors/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });

    const name = req.body.name || `vendor-${Date.now()}`;
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `${safeName}.png`;
    const outputPath = path.join(LOGOS_DIR, filename);

    await sharp(req.file.buffer)
      .resize({ width: 200, height: 200, fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ quality: 90 })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    res.json({
      success: true,
      filename,
      size: `${Math.round(stats.size / 1024)}KB`,
      path: `/images/logos/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate src/data/vendors.json from the store. Runs automatically after
// every vendor change, and is exposed via the endpoint below.
function syncVendorsToWebsite() {
  const data = loadVendors();
  const websiteVendors = data.vendors
    .filter(v => v.showOnWebsite)
    .map(v => {
      const nostrUrl = v.nostrNpub ? `https://njump.me/${v.nostrNpub}` : '';
      const xUrl = v.xProfileUrl || '';
      const websiteUrl = v.websiteUrl || '';
      const primaryUrl = websiteUrl || nostrUrl || xUrl;
      return {
        name: v.name,
        country: v.country || '',
        shippingRegions: v.shippingRegions || [],
        shopType: v.shopType || 'online',
        description: v.description || '',
        url: primaryUrl,
        logo: v.logoUrl || v.nostrProfilePic || v.xProfilePic || '',
        nostrUrl,
        xUrl,
        featured: !!v.featured,
      };
    });
  const exportDir = path.dirname(VENDORS_EXPORT_FILE);
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  writeJsonAtomic(VENDORS_EXPORT_FILE, { vendors: websiteVendors });
  return websiteVendors.length;
}

app.post('/api/vendors/sync', (req, res) => {
  try {
    const exported = syncVendorsToWebsite();
    res.json({ success: true, exported, path: 'src/data/vendors.json' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Pending Vendor Applications (synced from the live site) ---
//
// Prospective vendors apply via the market-page form, which stores submissions
// in Netlify Blobs. These endpoints let the admin tool pull those pending
// applications and import approved ones as vendors (created hidden, i.e.
// "pending approval", until the operator flips "Show on Website").
//
// Configure with environment variables before launching the admin server:
//   LP_SITE_URL            — site base URL (default https://lightningpiggy.com)
//   LP_ADMIN_SYNC_TOKEN    — must match ADMIN_SYNC_TOKEN set in Netlify
const SITE_URL = (process.env.LP_SITE_URL || 'https://lightningpiggy.com').replace(/\/$/, '');
const ADMIN_SYNC_TOKEN = process.env.LP_ADMIN_SYNC_TOKEN || '';
const SUBMISSIONS_ENDPOINT = `${SITE_URL}/.netlify/functions/vendor-submissions`;

async function callSubmissionsApi(method, payload) {
  if (!ADMIN_SYNC_TOKEN) {
    const err = new Error('LP_ADMIN_SYNC_TOKEN is not set. Add it to the admin server environment to sync vendor applications.');
    err.statusCode = 400;
    throw err;
  }
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${ADMIN_SYNC_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (payload) opts.body = JSON.stringify(payload);
  const resp = await fetch(SUBMISSIONS_ENDPOINT, opts);
  let data = {};
  try { data = await resp.json(); } catch {}
  if (!resp.ok) {
    const err = new Error(data.error || `Submissions API error (HTTP ${resp.status})`);
    err.statusCode = resp.status;
    throw err;
  }
  return data;
}

// List pending vendor applications from the live site
app.get('/api/vendors/submissions', async (req, res) => {
  try {
    const data = await callSubmissionsApi('GET');
    res.json({ submissions: data.submissions || [], configured: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, configured: !!ADMIN_SYNC_TOKEN });
  }
});

// Import a submission as a new (hidden / pending-approval) vendor, then mark
// it imported on the server so it drops out of the pending list.
app.post('/api/vendors/submissions/:id/import', async (req, res) => {
  try {
    const s = req.body || {};
    const data = loadVendors();
    const vendor = {
      id: crypto.randomUUID(),
      name: s.name || '',
      country: s.country || '',
      shippingRegions: Array.isArray(s.shippingRegions) ? s.shippingRegions : [],
      shopType: s.shopType || 'online',
      // Public website description comes from the dedicated store-description
      // field; fall back to the old combined description for legacy submissions.
      description: s.storeDescription || s.description || '',
      websiteUrl: s.websiteUrl || '',
      nostrNpub: s.nostrNpub || '',
      nostrProfilePic: '',
      xProfileUrl: s.xProfileUrl || '',
      xProfilePic: '',
      logoUrl: '',
      contactEmail: s.contactEmail || '',
      showOnWebsite: false, // pending approval until operator enables it
      featured: false,
      dateAdded: new Date().toISOString().split('T')[0],
      sourceSubmissionId: req.params.id,
    };
    data.vendors.push(vendor);
    saveVendors(data);

    // Best-effort: mark imported on the server so it leaves the pending queue.
    let serverUpdated = true;
    let serverError = null;
    try {
      await callSubmissionsApi('POST', { id: req.params.id, action: 'imported' });
    } catch (err) {
      serverUpdated = false;
      serverError = err.message;
    }

    res.json({ success: true, vendor, serverUpdated, serverError });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Dismiss (delete) a submission without importing it
app.post('/api/vendors/submissions/:id/dismiss', async (req, res) => {
  try {
    const data = await callSubmissionsApi('POST', { id: req.params.id, action: 'dismissed' });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// --- Resend CLI Endpoints ---

import { execFileSync } from 'child_process';

// args is an array of argv tokens (no shell), so user-supplied values like the
// test-email recipient can't inject shell commands.
function resendCmd(args) {
  try {
    const result = execFileSync('resend', [...args, '--json'], { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(result);
  } catch (err) {
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    throw new Error(stderr || stdout || err.message);
  }
}

app.get('/api/resend/status', (req, res) => {
  try {
    const whoami = resendCmd(['whoami']);
    const doctor = resendCmd(['doctor']);
    res.json({ authenticated: true, whoami, doctor });
  } catch (err) {
    res.json({ authenticated: false, error: err.message });
  }
});

app.get('/api/resend/domains', (req, res) => {
  try {
    const domains = resendCmd(['domains', 'list']);
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resend/contacts', (req, res) => {
  try {
    let allContacts = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      const args = cursor
        ? ['contacts', 'list', '--limit', '100', '--after', cursor]
        : ['contacts', 'list', '--limit', '100'];
      const result = resendCmd(args);
      const batch = Array.isArray(result) ? result : (result.data || []);
      allContacts = allContacts.concat(batch);
      hasMore = result.has_more === true;
      if (hasMore && batch.length > 0) cursor = batch[batch.length - 1].id;
      else hasMore = false;
    }
    const contacts = { data: allContacts };
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/resend/send-test', (req, res) => {
  try {
    const { to, subject, html } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' });
    if (!/^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/.test(String(to)))
      return res.status(400).json({ error: 'Invalid recipient email' });
    const from = 'newsletter@mail.lightningpiggy.com';
    const result = resendCmd([
      'emails', 'send',
      '--from', from,
      '--to', String(to),
      '--subject', String(subject),
      '--html', html || '<p>Test email from Lightning Piggy Admin</p>',
    ]);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resend/webhooks', (req, res) => {
  try {
    const webhooks = resendCmd(['webhooks', 'list']);
    res.json(webhooks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- NIP-05 Live Verification ---

app.get('/api/nip05/verify', async (req, res) => {
  try {
    const resp = await fetch('https://lightningpiggy.com/.well-known/nostr.json');
    if (!resp.ok) throw new Error('Failed to fetch nostr.json: ' + resp.status);
    const data = await resp.json();
    const names = data.names || {};
    const relays = data.relays || {};
    const results = Object.entries(names).map(([name, hex]) => ({
      name,
      hex,
      address: name + '@lightningpiggy.com',
      relayCount: (relays[hex] || []).length,
      relays: relays[hex] || [],
    }));
    res.json({ verified: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Serial Monitor + Device Screenshot ---

const VALID_DEVICE_RE = /^\/dev\/[a-zA-Z0-9._-]+$/;

/**
 * Single-port serial monitor that fans out incoming bytes to any number of
 * WebSocket clients. The port is opened on first client, closed when the last
 * client leaves. Can be temporarily released so mpremote (screenshot) can take
 * exclusive access.
 */
class SerialMonitor {
  constructor() {
    this.port = null;
    this.clients = new Set();   // ws -> ws
    this.devicePath = null;
    this.baudRate = 115200;
    this.suspended = false;     // true while screenshot is borrowing the port
  }

  attach(ws, devicePath, baudRate) {
    if (!VALID_DEVICE_RE.test(devicePath)) {
      ws.close(1008, 'invalid device path');
      return;
    }
    // If a different port is requested, switch all clients to it.
    if (this.port && (this.devicePath !== devicePath || this.baudRate !== baudRate)) {
      this._closePort();
    }
    this.devicePath = devicePath;
    this.baudRate = baudRate;
    this.clients.add(ws);
    ws.on('close', () => this._detach(ws));
    ws.on('error', () => this._detach(ws));
    if (!this.port && !this.suspended) {
      this._openPort();
    } else if (this.suspended) {
      this._sendOne(ws, { type: 'status', state: 'suspended' });
    } else if (this.port && this.port.isOpen) {
      this._sendOne(ws, { type: 'status', state: 'open', device: this.devicePath, baud: this.baudRate });
    }
  }

  _detach(ws) {
    this.clients.delete(ws);
    if (this.clients.size === 0) {
      this._closePort();
    }
  }

  _openPort() {
    if (this.port) return;
    try {
      this.port = new SerialPort({ path: this.devicePath, baudRate: this.baudRate, autoOpen: true });
    } catch (err) {
      this._broadcast({ type: 'error', message: 'open failed: ' + err.message });
      this.port = null;
      return;
    }
    this.port.on('open', () => {
      // mpremote may have left the device in raw REPL mode where print() output
      // is captured into the protocol response instead of streaming to CDC.
      // Ctrl+B drops the device back to friendly REPL, after which background
      // print() statements (e.g. from running asyncio tasks) flow normally.
      try { this.port.write(Buffer.from([0x02])); } catch (e) { /* ignore */ }
      this._broadcast({ type: 'status', state: 'open', device: this.devicePath, baud: this.baudRate });
    });
    this.port.on('error', (err) => this._broadcast({ type: 'error', message: err.message }));
    this.port.on('close', () => this._broadcast({ type: 'status', state: 'closed' }));
    this.port.on('data', (data) => this._broadcast({ type: 'data', text: data.toString('utf8') }));
  }

  _closePort() {
    if (!this.port) return;
    const p = this.port;
    this.port = null;
    try { p.close(() => {}); } catch (e) { /* ignore */ }
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  _sendOne(ws, msg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Release the serial port so mpremote can take it. Returns when the port is fully closed. */
  async suspend() {
    this.suspended = true;
    if (!this.port) return;
    this._broadcast({ type: 'status', state: 'suspended' });
    return new Promise((resolve) => {
      const p = this.port;
      this.port = null;
      try {
        p.close((err) => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  /** Reopen the serial port if any clients are still watching. */
  resume() {
    this.suspended = false;
    if (this.clients.size > 0 && this.devicePath) {
      this._openPort();
    }
  }
}

const serialMonitor = new SerialMonitor();

// Tracks the file location of the most recent capture so /api/device/screenshot.png
// can serve it back to the browser regardless of where the user chose to save it.
let lastScreenshotPath = DEVICE_SCREENSHOT_FILE;

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function validateSavePath(raw) {
  const expanded = expandHome((raw || '').trim());
  if (!expanded) return DEVICE_SCREENSHOT_FILE;
  if (!path.isAbsolute(expanded)) {
    throw new Error('save path must be absolute or start with ~');
  }
  // Block obvious traversal tricks (after expansion ~/foo/../bar would still be valid,
  // so just check the literal expansion).
  if (expanded.split(path.sep).includes('..')) {
    throw new Error('save path must not contain ..');
  }
  if (!expanded.toLowerCase().endsWith('.png')) {
    throw new Error('save path must end with .png');
  }
  return expanded;
}

app.post('/api/device/capture', async (req, res) => {
  const device = (req.body && req.body.device) || '/dev/cu.usbmodem101';
  if (!VALID_DEVICE_RE.test(device)) {
    return res.status(400).json({ error: 'invalid device path' });
  }
  let savePath;
  try {
    savePath = validateSavePath(req.body && req.body.savePath);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fs.existsSync(DEVICE_SCREENSHOT_SCRIPT)) {
    return res.status(500).json({
      error: `screenshot helper not found at ${DEVICE_SCREENSHOT_SCRIPT}. Set LP_DEVICE_SCREENSHOT_SCRIPT to override.`,
    });
  }
  // Hand the port over to mpremote temporarily.
  await serialMonitor.suspend();
  try {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    await execFileAsync(DEVICE_SCREENSHOT_SCRIPT, [device, savePath], {
      // mpremote's file copy of the ~230KB framebuffer is slow (~100s), so allow
      // generous headroom.
      timeout: 240000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const stat = fs.statSync(savePath);
    lastScreenshotPath = savePath;
    res.json({ ok: true, savedAt: savePath, size: stat.size, mtime: stat.mtimeMs });
  } catch (err) {
    const detail = (err.stderr || '').toString().trim() || err.message;
    res.status(500).json({ error: detail });
  } finally {
    serialMonitor.resume();
  }
});

app.get('/api/device/screenshot.png', (req, res) => {
  if (!lastScreenshotPath || !fs.existsSync(lastScreenshotPath)) {
    return res.status(404).type('text/plain').send('no screenshot yet - click Capture');
  }
  res.set('Cache-Control', 'no-cache, no-store');
  res.sendFile(lastScreenshotPath);
});

// --- Start Server ---

const PORT = 3000;
const wss = new WebSocketServer({ noServer: true });

// Bind to loopback only: this admin tool has no auth, so it must never be
// reachable from the LAN. 127.0.0.1 keeps it to this machine.
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🐽 LightningPiggy Admin`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
  console.log(`  Project root: ${ROOT}`);
  console.log(`  Wild photos:  ${WILD_DIR}`);
  console.log(`  News posts:   ${NEWS_DIR}`);
  console.log(`  Credits:      ${CREDITS_FILE}`);
  console.log(`  Partners:     ${PARTNERS_FILE}`);
  console.log(`  Testimonials: ${TESTIMONIALS_FILE}`);
  console.log(`  Vendors:      ${VENDORS_FILE}`);
  console.log(`  Export to:    ${CREDITS_EXPORT_FILE}`);
  console.log(`  Partners to:  ${PARTNERS_EXPORT_FILE}`);
  console.log(`  Testimonials: ${TESTIMONIALS_EXPORT_FILE}`);
  console.log(`  Vendors to:   ${VENDORS_EXPORT_FILE}`);
  console.log(`  Device shot:  ${DEVICE_SCREENSHOT_SCRIPT}\n`);
});

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // Same access control as the HTTP API: allowlisted Host + valid token.
  // Browsers can't set custom headers on a WebSocket, so the token comes in as
  // a query param (the connection is loopback-only, so it isn't exposed).
  if (!ALLOWED_HOSTS.has((req.headers.host || '').toLowerCase())) {
    socket.destroy();
    return;
  }
  if (searchParams.get('token') !== ADMIN_TOKEN) {
    socket.destroy();
    return;
  }
  if (pathname !== '/api/device/serial') {
    socket.destroy();
    return;
  }
  const device = searchParams.get('device') || '/dev/cu.usbmodem101';
  const baud = parseInt(searchParams.get('baud') || '115200', 10);
  wss.handleUpgrade(req, socket, head, (ws) => {
    serialMonitor.attach(ws, device, baud);
  });
});
