import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WILD_DIR = path.join(ROOT, 'public', 'images', 'wild');
const SHOWCASE_DIR = path.join(ROOT, 'public', 'images', 'showcase');
const NEWS_DIR = path.join(ROOT, 'src', 'content', 'news');
const CREDITS_FILE = path.join(os.homedir(), '.lightningpiggy', 'credits.json');
const CREDITS_EXPORT_FILE = path.join(ROOT, 'src', 'data', 'credits.json');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/branding', express.static(path.join(ROOT, 'public', 'images', 'branding')));
app.use(express.json());

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

// --- News Post Endpoints ---

app.post('/api/news/publish', upload.single('heroImage'), async (req, res) => {
  try {
    const { title, slug, description, pubDate, tags, content } = req.body;

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
    frontmatter += `---\n\n`;

    fs.writeFileSync(path.join(postDir, 'index.md'), frontmatter + content);

    res.json({ success: true, slug, path: `/news/${slug}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    // Group by section
    const grouped = {
      coreTeam: websiteCredits
        .filter(c => c.websiteSection === 'Core Team')
        .map(c => ({
          name: c.name,
          contribution: c.role.replace(/^Core Team\s*-\s*/i, ''),
          url: c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : c.xProfileUrl || '',
          avatar: c.nostrProfilePic || c.xProfilePic || '',
        })),
      contributors: websiteCredits
        .filter(c => c.websiteSection === 'Contributor')
        .map(c => ({
          name: c.name,
          contribution: c.role.replace(/^Contributor\s*-\s*/i, ''),
          url: c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : c.xProfileUrl || '',
          avatar: c.nostrProfilePic || c.xProfilePic || '',
          isBitcoinKid: c.isBitcoinKid || false,
        })),
      specialThanks: websiteCredits
        .filter(c => c.websiteSection === 'Special Thanks')
        .map(c => ({
          name: c.name,
          url: c.nostrNpub ? `https://njump.me/${c.nostrNpub}` : c.xProfileUrl || '',
          note: c.notes || '',
        })),
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

// --- Start Server ---

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n  🐷 LightningPiggy Admin`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
  console.log(`  Project root: ${ROOT}`);
  console.log(`  Wild photos:  ${WILD_DIR}`);
  console.log(`  News posts:   ${NEWS_DIR}`);
  console.log(`  Credits:      ${CREDITS_FILE}`);
  console.log(`  Export to:    ${CREDITS_EXPORT_FILE}\n`);
});
