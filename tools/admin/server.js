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

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  || path.join(os.homedir(), 'MicroPythonOS', 'MicroPythonOS', 'scripts', 'device_screenshot.sh');
const DEVICE_SCREENSHOT_FILE = path.join(os.homedir(), '.lightningpiggy', 'device_screenshot.png');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/branding', express.static(path.join(ROOT, 'public', 'images', 'branding')));
app.use('/images/testimonials', express.static(path.join(ROOT, 'public', 'images', 'testimonials')));
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
    const defaultPath = req.body?.defaultPath ? `default location POSIX file "${req.body.defaultPath.replace(/^~/, os.homedir())}"` : '';
    const script = `tell application "System Events" to activate
POSIX path of (choose folder with prompt "Select save folder for captures" ${defaultPath})`;
    const { stdout } = await execFileAsync('osascript', ['-e', script]);
    let folder = stdout.trim().replace(/\/$/, '');
    const home = os.homedir();
    const display = folder === home ? '~' : folder.startsWith(home + '/') ? '~' + folder.slice(home.length) : folder;
    res.json({ path: folder, display });
  } catch (err) {
    // User cancelled — osascript exits with error
    if (err.stderr && err.stderr.includes('User canceled')) {
      return res.status(204).end();
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Admin control ---
// Ping endpoint used by the launcher app to check if the server is running.
app.get('/api/admin/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

// --- Deploy (git push to trigger Netlify build) ---

async function gitCmd(args, opts = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd: ROOT, ...opts });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

app.get('/api/deploy/status', async (req, res) => {
  try {
    // Get current branch and ahead/behind status
    const branch = (await gitCmd(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    let ahead = 0, behind = 0;
    try {
      const counts = (await gitCmd(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).stdout.trim();
      const [a, b] = counts.split(/\s+/).map(n => parseInt(n, 10));
      ahead = a || 0; behind = b || 0;
    } catch {}

    // Parse porcelain status
    const status = (await gitCmd(['status', '--porcelain'])).stdout;
    const modified = []; // tracked files that are modified/deleted/etc
    const untracked = []; // new files not yet tracked
    status.split('\n').filter(Boolean).forEach(line => {
      const code = line.slice(0, 2);
      const path = line.slice(3);
      if (code.startsWith('??')) {
        untracked.push({ code, path });
      } else {
        modified.push({ code, path });
      }
    });

    res.json({ branch, ahead, behind, modified, untracked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push-only (no new commits) — for when there are unpushed commits already
app.post('/api/deploy/push-only', async (req, res) => {
  try {
    const log = ['$ git push'];
    const { stdout, stderr } = await gitCmd(['push']);
    if (stdout) log.push(stdout.trim());
    if (stderr) log.push(stderr.trim());
    res.json({ success: true, output: log.join('\n') });
  } catch (err) {
    res.status(500).json({ error: err.message, output: (err.stdout || '') + (err.stderr || '') });
  }
});

app.post('/api/deploy/push', async (req, res) => {
  try {
    const { message, files } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Commit message is required' });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files selected to commit' });
    }

    const log = [];
    const run = async (args) => {
      log.push('$ git ' + args.join(' '));
      try {
        const { stdout, stderr } = await gitCmd(args);
        if (stdout) log.push(stdout.trim());
        if (stderr) log.push(stderr.trim());
      } catch (e) {
        log.push('ERROR: ' + e.message);
        throw e;
      }
    };

    // Stage the selected files. Use -f to allow gitignored files (e.g. tools/admin/*).
    for (const f of files) {
      await run(['add', '-f', f]);
    }

    // Commit
    await run(['commit', '-m', message]);

    // Push
    await run(['push']);

    res.json({ success: true, output: log.join('\n') });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      output: (err.stdout || '') + (err.stderr || ''),
    });
  }
});

app.get('/api/fs/ls', (req, res) => {
  try {
    const reqPath = (req.query.path || '~').toString();
    const abs = expandPath(reqPath);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    const home = os.homedir();
    const display = abs === home ? '~' : abs.startsWith(home + '/') ? '~' + abs.slice(home.length) : abs;
    const parent = path.dirname(abs);
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

app.post('/api/news/publish', upload.single('heroImage'), async (req, res) => {
  try {
    const { title, slug, description, pubDate, tags, content, category, url } = req.body;

    if (!title || !slug || !content) {
      return res.status(400).json({ error: 'Title, slug, and content are required' });
    }

    const postDir = path.join(NEWS_DIR, slug);
    if (fs.existsSync(postDir)) {
      return res.status(400).json({ error: `News post "${slug}" already exists` });
    }

    fs.mkdirSync(postDir, { recursive: true });

    // Process hero image if provided
    let heroFilename = '';
    if (req.file) {
      heroFilename = `hero.jpeg`;
      await sharp(req.file.buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(path.join(postDir, heroFilename));
    }

    // Build frontmatter
    const tagsList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    let frontmatter = `---\ntitle: "${title}"\nslug: ${slug}\n`;
    if (description) frontmatter += `description: "${description}"\n`;
    frontmatter += `pubDate: ${pubDate || new Date().toISOString().split('T')[0]}\n`;
    if (heroFilename) frontmatter += `heroImage: './${heroFilename}'\n`;
    if (tagsList.length) frontmatter += `tags: [${tagsList.map(t => `"${t}"`).join(', ')}]\n`;
    if (category) frontmatter += `category: ${category}\n`;
    if (url) frontmatter += `url: "${url}"\n`;
    frontmatter += `---\n\n`;

    fs.writeFileSync(path.join(postDir, 'index.md'), frontmatter + content);

    res.json({ success: true, slug, path: `/news/${slug}` });
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
  try {
    if (!fs.existsSync(CREDITS_FILE)) {
      const dir = path.dirname(CREDITS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CREDITS_FILE, JSON.stringify({ credits: [], schema_version: 1 }, null, 2));
    }
    return JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf-8'));
  } catch (err) {
    return { credits: [], schema_version: 1 };
  }
}

function saveCredits(data) {
  const dir = path.dirname(CREDITS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CREDITS_FILE, JSON.stringify(data, null, 2));
}

// Get all credits
app.get('/api/credits', (req, res) => {
  const data = loadCredits();
  res.json(data.credits);
});

// Add a new credit
app.post('/api/credits', (req, res) => {
  try {
    const data = loadCredits();
    const credit = {
      id: crypto.randomUUID(),
      name: req.body.name || '',
      email: req.body.email || '',
      role: req.body.role || '',
      lightningAddress: req.body.lightningAddress || '',
      nostrNpub: req.body.nostrNpub || '',
      nostrHex: req.body.nostrHex || '',
      nostrProfilePic: req.body.nostrProfilePic || '',
      xProfileUrl: req.body.xProfileUrl || '',
      xProfilePic: req.body.xProfilePic || '',
      websiteUrl: req.body.websiteUrl || '',
      githubUrl: req.body.githubUrl || '',
      notes: req.body.notes || '',
      showOnWebsite: req.body.showOnWebsite ?? false,
      websiteSection: req.body.websiteSection || '',
      isBitcoinKid: req.body.isBitcoinKid ?? false,
      dateAdded: req.body.dateAdded || new Date().toISOString().split('T')[0],
    };
    data.credits.push(credit);
    saveCredits(data);
    res.json({ success: true, credit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder credits (must be before :id route)
app.put('/api/credits/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const data = loadCredits();

    // Build a map of id -> credit for quick lookup
    const creditMap = new Map(data.credits.map(c => [c.id, c]));

    // Rebuild the credits array in the new order
    const reordered = ids.map(id => creditMap.get(id)).filter(Boolean);

    // Append any credits not included in the ids list (shouldn't happen, but safe)
    const reorderedIds = new Set(ids);
    for (const c of data.credits) {
      if (!reorderedIds.has(c.id)) {
        reordered.push(c);
      }
    }

    data.credits = reordered;
    saveCredits(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a credit
app.put('/api/credits/:id', (req, res) => {
  try {
    const data = loadCredits();
    const index = data.credits.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Credit not found' });
    }
    data.credits[index] = {
      ...data.credits[index],
      name: req.body.name ?? data.credits[index].name,
      email: req.body.email ?? data.credits[index].email,
      role: req.body.role ?? data.credits[index].role,
      lightningAddress: req.body.lightningAddress ?? data.credits[index].lightningAddress,
      nostrNpub: req.body.nostrNpub ?? data.credits[index].nostrNpub,
      nostrHex: req.body.nostrHex ?? data.credits[index].nostrHex,
      nostrProfilePic: req.body.nostrProfilePic ?? data.credits[index].nostrProfilePic,
      xProfileUrl: req.body.xProfileUrl ?? data.credits[index].xProfileUrl,
      xProfilePic: req.body.xProfilePic ?? data.credits[index].xProfilePic,
      websiteUrl: req.body.websiteUrl ?? data.credits[index].websiteUrl ?? '',
      githubUrl: req.body.githubUrl ?? data.credits[index].githubUrl ?? '',
      notes: req.body.notes ?? data.credits[index].notes,
      showOnWebsite: req.body.showOnWebsite ?? data.credits[index].showOnWebsite ?? false,
      websiteSection: req.body.websiteSection ?? data.credits[index].websiteSection ?? '',
      isBitcoinKid: req.body.isBitcoinKid ?? data.credits[index].isBitcoinKid ?? false,
    };
    saveCredits(data);
    res.json({ success: true, credit: data.credits[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a credit
app.delete('/api/credits/:id', (req, res) => {
  try {
    const data = loadCredits();
    const index = data.credits.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Credit not found' });
    }
    const deleted = data.credits.splice(index, 1)[0];
    saveCredits(data);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync credits to website (export only showOnWebsite: true entries)
app.post('/api/credits/sync', (req, res) => {
  try {
    const data = loadCredits();
    const sections = req.body.sections || ['Core Team', 'Contributor', 'Special Thanks'];

    // Filter credits that should appear on website and are in enabled sections
    const websiteCredits = data.credits.filter(c =>
      c.showOnWebsite && sections.includes(c.websiteSection)
    );

    // Helper to build credit object with link priority
    const buildCreditObj = (c, includeContribution = true, includeNote = false) => {
      const nostrUrl = c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : '';
      const xUrl = c.xProfileUrl || '';
      const websiteUrl = c.websiteUrl || '';
      const githubUrl = c.githubUrl || '';

      // Priority: websiteUrl > nostrUrl > xUrl
      const primaryUrl = websiteUrl || nostrUrl || xUrl;

      const obj = {
        name: c.name,
        url: primaryUrl,
        avatar: c.nostrProfilePic || c.xProfilePic || '',
        isBitcoinKid: c.isBitcoinKid || false,
        // Always include social URLs for icons
        nostrUrl: nostrUrl,
        xUrl: xUrl,
        githubUrl: githubUrl,
      };

      if (includeContribution) {
        obj.contribution = c.notes || '';
      }
      if (includeNote) {
        obj.note = c.notes || '';
      }

      return obj;
    };

    // Group by section (Special Thanks merged into Contributors)
    const grouped = {
      coreTeam: websiteCredits
        .filter(c => c.websiteSection === 'Core Team')
        .map(c => buildCreditObj(c, true, false)),
      contributors: websiteCredits
        .filter(c => c.websiteSection === 'Contributor' || c.websiteSection === 'Special Thanks')
        .map(c => buildCreditObj(c, c.websiteSection === 'Contributor', c.websiteSection === 'Special Thanks')),
      specialThanks: [], // Kept for backwards compatibility
    };

    // Ensure data directory exists
    const exportDir = path.dirname(CREDITS_EXPORT_FILE);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    // Write to website data file
    fs.writeFileSync(CREDITS_EXPORT_FILE, JSON.stringify(grouped, null, 2));

    res.json({
      success: true,
      exported: {
        coreTeam: grouped.coreTeam.length,
        contributors: grouped.contributors.length,
        specialThanks: grouped.specialThanks.length,
      },
      path: 'src/data/credits.json',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Partners Endpoints ---

function loadPartners() {
  try {
    if (!fs.existsSync(PARTNERS_FILE)) {
      const dir = path.dirname(PARTNERS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PARTNERS_FILE, JSON.stringify({ partners: [], schema_version: 1 }, null, 2));
    }
    return JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf-8'));
  } catch (err) {
    return { partners: [], schema_version: 1 };
  }
}

function savePartners(data) {
  const dir = path.dirname(PARTNERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PARTNERS_FILE, JSON.stringify(data, null, 2));
}

// Get all partners
app.get('/api/partners', (req, res) => {
  const data = loadPartners();
  res.json(data.partners);
});

// Add a new partner
app.post('/api/partners', (req, res) => {
  try {
    const data = loadPartners();
    const partner = {
      id: crypto.randomUUID(),
      name: req.body.name || '',
      description: req.body.description || '',
      websiteUrl: req.body.websiteUrl || '',
      logoUrl: req.body.logoUrl || '',
      nostrNpub: req.body.nostrNpub || '',
      nostrProfilePic: req.body.nostrProfilePic || '',
      xProfileUrl: req.body.xProfileUrl || '',
      xProfilePic: req.body.xProfilePic || '',
      githubUrl: req.body.githubUrl || '',
      section: req.body.section || '',
      showOnWebsite: req.body.showOnWebsite ?? false,
      dateAdded: req.body.dateAdded || new Date().toISOString().split('T')[0],
    };
    data.partners.push(partner);
    savePartners(data);
    res.json({ success: true, partner });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder partners (must be before :id route)
app.put('/api/partners/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    const data = loadPartners();

    // Build a map of id -> partner for quick lookup
    const partnerMap = new Map(data.partners.map(p => [p.id, p]));

    // Rebuild the partners array in the new order
    const reordered = ids.map(id => partnerMap.get(id)).filter(Boolean);

    // Append any partners not included in the ids list (shouldn't happen, but safe)
    const reorderedIds = new Set(ids);
    for (const p of data.partners) {
      if (!reorderedIds.has(p.id)) {
        reordered.push(p);
      }
    }

    data.partners = reordered;
    savePartners(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a partner
app.put('/api/partners/:id', (req, res) => {
  try {
    const data = loadPartners();
    const index = data.partners.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    data.partners[index] = {
      ...data.partners[index],
      name: req.body.name ?? data.partners[index].name,
      description: req.body.description ?? data.partners[index].description,
      websiteUrl: req.body.websiteUrl ?? data.partners[index].websiteUrl,
      logoUrl: req.body.logoUrl ?? data.partners[index].logoUrl,
      nostrNpub: req.body.nostrNpub ?? data.partners[index].nostrNpub,
      nostrProfilePic: req.body.nostrProfilePic ?? data.partners[index].nostrProfilePic,
      xProfileUrl: req.body.xProfileUrl ?? data.partners[index].xProfileUrl,
      xProfilePic: req.body.xProfilePic ?? data.partners[index].xProfilePic,
      githubUrl: req.body.githubUrl ?? data.partners[index].githubUrl ?? '',
      section: req.body.section ?? data.partners[index].section,
      showOnWebsite: req.body.showOnWebsite ?? data.partners[index].showOnWebsite,
    };
    savePartners(data);
    res.json({ success: true, partner: data.partners[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a partner
app.delete('/api/partners/:id', (req, res) => {
  try {
    const data = loadPartners();
    const index = data.partners.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Partner not found' });
    }
    const deleted = data.partners.splice(index, 1)[0];
    savePartners(data);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    fs.writeFileSync(PARTNERS_EXPORT_FILE, JSON.stringify(grouped, null, 2));

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
      fs.writeFileSync(NOSTR_JSON_FILE, JSON.stringify({ names: {}, relays: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(NOSTR_JSON_FILE, 'utf-8'));
  } catch (err) {
    return { names: {}, relays: {} };
  }
}

function saveNostrJson(data) {
  const dir = path.dirname(NOSTR_JSON_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(NOSTR_JSON_FILE, JSON.stringify(data, null, 2));
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
  try {
    if (!fs.existsSync(TESTIMONIALS_FILE)) {
      const dir = path.dirname(TESTIMONIALS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TESTIMONIALS_FILE, JSON.stringify({ testimonials: [], schema_version: 1 }, null, 2));
    }
    return JSON.parse(fs.readFileSync(TESTIMONIALS_FILE, 'utf-8'));
  } catch (err) {
    return { testimonials: [], schema_version: 1 };
  }
}

function saveTestimonials(data) {
  const dir = path.dirname(TESTIMONIALS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TESTIMONIALS_FILE, JSON.stringify(data, null, 2));
}

// Get all testimonials
app.get('/api/testimonials', (req, res) => {
  const data = loadTestimonials();
  res.json(data.testimonials);
});

// Add a new testimonial
app.post('/api/testimonials', (req, res) => {
  try {
    const data = loadTestimonials();
    const testimonial = {
      id: crypto.randomUUID(),
      name: req.body.name || '',
      nostrNpub: req.body.nostrNpub || '',
      profilePic: req.body.profilePic || '',
      quote: req.body.quote || '',
      sourcePlatform: req.body.sourcePlatform || 'other',
      sourceUrl: req.body.sourceUrl || '',
      showOnWebsite: req.body.showOnWebsite ?? true,
      dateAdded: req.body.dateAdded || new Date().toISOString().split('T')[0],
    };
    data.testimonials.push(testimonial);
    saveTestimonials(data);
    res.json({ success: true, testimonial });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder testimonials (must be before :id route)
app.put('/api/testimonials/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }
    const data = loadTestimonials();
    const testimonialMap = new Map(data.testimonials.map(t => [t.id, t]));
    const reordered = ids.map(id => testimonialMap.get(id)).filter(Boolean);
    const reorderedIds = new Set(ids);
    for (const t of data.testimonials) {
      if (!reorderedIds.has(t.id)) reordered.push(t);
    }
    data.testimonials = reordered;
    saveTestimonials(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a testimonial
app.put('/api/testimonials/:id', (req, res) => {
  try {
    const data = loadTestimonials();
    const index = data.testimonials.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Testimonial not found' });
    }
    data.testimonials[index] = {
      ...data.testimonials[index],
      name: req.body.name ?? data.testimonials[index].name,
      nostrNpub: req.body.nostrNpub ?? data.testimonials[index].nostrNpub,
      profilePic: req.body.profilePic ?? data.testimonials[index].profilePic,
      quote: req.body.quote ?? data.testimonials[index].quote,
      sourcePlatform: req.body.sourcePlatform ?? data.testimonials[index].sourcePlatform,
      sourceUrl: req.body.sourceUrl ?? data.testimonials[index].sourceUrl,
      showOnWebsite: req.body.showOnWebsite ?? data.testimonials[index].showOnWebsite,
    };
    saveTestimonials(data);
    res.json({ success: true, testimonial: data.testimonials[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a testimonial
app.delete('/api/testimonials/:id', (req, res) => {
  try {
    const data = loadTestimonials();
    const index = data.testimonials.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Testimonial not found' });
    }
    const deleted = data.testimonials.splice(index, 1)[0];
    saveTestimonials(data);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
app.post('/api/testimonials/sync', (req, res) => {
  try {
    const data = loadTestimonials();

    // Filter testimonials that should appear on website
    const websiteTestimonials = data.testimonials
      .filter(t => t.showOnWebsite)
      .map(t => ({
        name: t.name,
        profilePic: t.profilePic || '',
        quote: t.quote,
        sourcePlatform: t.sourcePlatform,
        sourceUrl: t.sourceUrl,
      }));

    const exported = {
      testimonials: websiteTestimonials,
    };

    // Ensure data directory exists
    const exportDir = path.dirname(TESTIMONIALS_EXPORT_FILE);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    // Write to website data file
    fs.writeFileSync(TESTIMONIALS_EXPORT_FILE, JSON.stringify(exported, null, 2));

    res.json({
      success: true,
      exported: websiteTestimonials.length,
      path: 'src/data/testimonials.json',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Vendors Endpoints ---

function loadVendors() {
  try {
    if (!fs.existsSync(VENDORS_FILE)) {
      const dir = path.dirname(VENDORS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(VENDORS_FILE, JSON.stringify({ vendors: [], schema_version: 1 }, null, 2));
    }
    return JSON.parse(fs.readFileSync(VENDORS_FILE, 'utf-8'));
  } catch (err) {
    return { vendors: [], schema_version: 1 };
  }
}

function saveVendors(data) {
  const dir = path.dirname(VENDORS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VENDORS_FILE, JSON.stringify(data, null, 2));
}

// Get all vendors
app.get('/api/vendors', (req, res) => {
  const data = loadVendors();
  res.json(data.vendors);
});

// Add a new vendor
app.post('/api/vendors', (req, res) => {
  try {
    const data = loadVendors();
    const vendor = {
      id: crypto.randomUUID(),
      name: req.body.name || '',
      country: req.body.country || '',
      shippingRegions: req.body.shippingRegions || [],
      shopType: req.body.shopType || 'online',
      description: req.body.description || '',
      websiteUrl: req.body.websiteUrl || '',
      nostrNpub: req.body.nostrNpub || '',
      nostrProfilePic: req.body.nostrProfilePic || '',
      xProfileUrl: req.body.xProfileUrl || '',
      xProfilePic: req.body.xProfilePic || '',
      logoUrl: req.body.logoUrl || '',
      showOnWebsite: req.body.showOnWebsite ?? true,
      dateAdded: req.body.dateAdded || new Date().toISOString().split('T')[0],
    };
    data.vendors.push(vendor);
    saveVendors(data);
    res.json({ success: true, vendor });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reorder vendors (must be before :id route)
app.put('/api/vendors/reorder', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }
    const data = loadVendors();
    const vendorMap = new Map(data.vendors.map(v => [v.id, v]));
    const reordered = ids.map(id => vendorMap.get(id)).filter(Boolean);
    const reorderedIds = new Set(ids);
    for (const v of data.vendors) {
      if (!reorderedIds.has(v.id)) reordered.push(v);
    }
    data.vendors = reordered;
    saveVendors(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a vendor
app.put('/api/vendors/:id', (req, res) => {
  try {
    const data = loadVendors();
    const index = data.vendors.findIndex(v => v.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    data.vendors[index] = {
      ...data.vendors[index],
      name: req.body.name ?? data.vendors[index].name,
      country: req.body.country ?? data.vendors[index].country,
      shippingRegions: req.body.shippingRegions ?? data.vendors[index].shippingRegions,
      shopType: req.body.shopType ?? data.vendors[index].shopType,
      description: req.body.description ?? data.vendors[index].description,
      websiteUrl: req.body.websiteUrl ?? data.vendors[index].websiteUrl,
      nostrNpub: req.body.nostrNpub ?? data.vendors[index].nostrNpub,
      nostrProfilePic: req.body.nostrProfilePic ?? data.vendors[index].nostrProfilePic,
      xProfileUrl: req.body.xProfileUrl ?? data.vendors[index].xProfileUrl,
      xProfilePic: req.body.xProfilePic ?? data.vendors[index].xProfilePic,
      logoUrl: req.body.logoUrl ?? data.vendors[index].logoUrl,
      showOnWebsite: req.body.showOnWebsite ?? data.vendors[index].showOnWebsite,
    };
    saveVendors(data);
    res.json({ success: true, vendor: data.vendors[index] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a vendor
app.delete('/api/vendors/:id', (req, res) => {
  try {
    const data = loadVendors();
    const index = data.vendors.findIndex(v => v.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    const deleted = data.vendors.splice(index, 1)[0];
    saveVendors(data);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Sync vendors to website
app.post('/api/vendors/sync', (req, res) => {
  try {
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
        };
      });

    const exported = { vendors: websiteVendors };

    const exportDir = path.dirname(VENDORS_EXPORT_FILE);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    fs.writeFileSync(VENDORS_EXPORT_FILE, JSON.stringify(exported, null, 2));

    res.json({
      success: true,
      exported: websiteVendors.length,
      path: 'src/data/vendors.json',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Resend CLI Endpoints ---

import { execSync } from 'child_process';

function resendCmd(args) {
  try {
    const result = execSync(`resend ${args} --json`, { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(result);
  } catch (err) {
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    throw new Error(stderr || stdout || err.message);
  }
}

app.get('/api/resend/status', (req, res) => {
  try {
    const whoami = resendCmd('whoami');
    const doctor = resendCmd('doctor');
    res.json({ authenticated: true, whoami, doctor });
  } catch (err) {
    res.json({ authenticated: false, error: err.message });
  }
});

app.get('/api/resend/domains', (req, res) => {
  try {
    const domains = resendCmd('domains list');
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
      const args = cursor ? `contacts list --limit 100 --after ${cursor}` : 'contacts list --limit 100';
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
    const from = 'newsletter@mail.lightningpiggy.com';
    const result = resendCmd(`emails send --from "${from}" --to "${to}" --subject "${subject.replace(/"/g, '\\"')}" --html "${(html || '<p>Test email from Lightning Piggy Admin</p>').replace(/"/g, '\\"')}"`);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resend/webhooks', (req, res) => {
  try {
    const webhooks = resendCmd('webhooks list');
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
      timeout: 120000,
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
    return res.status(404).type('text/plain').send('no screenshot yet — click Capture');
  }
  res.set('Cache-Control', 'no-cache, no-store');
  res.sendFile(lastScreenshotPath);
});

// --- Start Server ---

const PORT = 3000;
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(PORT, () => {
  console.log(`\n  🐷 LightningPiggy Admin`);
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
