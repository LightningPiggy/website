# Running the LightningPiggy website locally

A quick guide to getting the site running on your machine so you can help develop it.

The site is built with [Astro](https://astro.build/). The dev server runs at
**http://localhost:4321** and hot-reloads as you edit.

---

## 1. Prerequisites (install once)

- **Git** — <https://git-scm.com/downloads>
- **Node.js 20 LTS** — <https://nodejs.org/> (or via [nvm](https://github.com/nvm-sh/nvm))
  Astro needs Node ≥ 18.20; **20 LTS** is the safe choice.

Check they're installed:

```bash
git --version
node -v
```

## 2. Get the code

```bash
git clone https://github.com/LightningPiggy/website.git
cd website
```

## 3. Start the dev server

**Easy way — the launcher script** (installs dependencies on first run, then starts the server):

```bash
./start-dev.sh        # macOS / Linux
start-dev.bat         # Windows (or just double-click it)
```

**Manual way** (does exactly the same thing):

```bash
npm install
npm run dev
```

## 4. Open it

Visit **<http://localhost:4321>**. Save any file and the browser updates automatically.
Press **Ctrl+C** to stop the server.

No `.env` file or secrets are needed for normal content and UI development.

---

## Where things live (for editing)

| Path | What's there |
|------|--------------|
| `src/content/` | News, guides, and pages (Markdown) |
| `src/components/` | Reusable UI components (`.astro`) |
| `src/pages/` | Routes (each file = a URL) |
| `src/layouts/` | Page shells/wrappers |
| `src/styles/global.css` | Global styles (Tailwind CSS) |
| `public/` | Static assets served as-is |
| `netlify/functions/` | Serverless functions (invoices, newsletter, NIP-05…) |

## Handy commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server (http://localhost:4321) |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run admin` | Start the admin server (`tools/admin`, port 3000) |
| `npm run lint:md` | Lint & auto-fix Markdown in content |

## Optional: full stack with serverless functions

Normal content/UI work doesn't need this. But if you're working on features that call
the functions in `netlify/functions/` (Lightning invoices, newsletter signup, NIP-05, etc.),
install the Netlify CLI once and run it instead of `npm run dev`:

```bash
npm install -g netlify-cli
netlify dev
```

---

## Contributing changes back

1. **Fork** the repo on GitHub (or ask a maintainer to add you as a collaborator).
2. Create a branch:  `git checkout -b my-change`
3. Make your edits, then commit and push.
4. Open a **Pull Request** against `LightningPiggy/website` → `main`.

Merges to `main` automatically deploy to <https://lightningpiggy.com> via Netlify, and every
PR gets its own preview URL to check before merging.

## Troubleshooting

- **`node: command not found`** — Node isn't installed or not on your PATH. Reinstall Node 20 LTS and reopen the terminal.
- **Port 4321 already in use** — something else is running on that port. Stop it, or run `npm run dev -- --port 4322`.
- **Weird dependency errors after pulling changes** — delete `node_modules` and reinstall: `rm -rf node_modules && npm install`.
- **`./start-dev.sh: permission denied`** — make it executable once: `chmod +x start-dev.sh`.
