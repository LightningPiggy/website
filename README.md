# LightningPiggy Website

The official website for [Lightning Piggy](https://lightningpiggy.com) — an open-source Bitcoin piggy bank that teaches smart savers sound money with sats.

## Tech Stack

- **[Astro](https://astro.build)** v5 — Static site generator
- **[Tailwind CSS](https://tailwindcss.com)** v3 — Utility-first styling
- **MDX** — Markdown content with component support
- **[Netlify](https://netlify.com)** — Hosting & deployment

## Quick Start

```bash
npm install        # Install dependencies
npm run dev        # Start dev server → http://localhost:4321
npm run build      # Build for production
npm run preview    # Preview production build
```

## Project Structure

```
src/
├── components/
│   ├── landing/         # Homepage sections (Hero, Features, Testimonials, etc.)
│   ├── layout/          # Header & Footer
│   ├── market/          # Nostr marketplace integration
│   └── ui/              # Reusable components (Button, Card, NewsletterForm)
├── content/
│   ├── guides/          # Build guides (v1, v2), LNbits setup, Troubleshooting
│   ├── news/            # News & update posts
│   └── pages/           # FAQs
├── data/                # JSON data (credits, partners, testimonials)
├── layouts/             # BaseLayout, BlogPost, ContentLayout
├── pages/               # File-based routing (23 pages)
└── styles/              # Global CSS & Tailwind config

public/
├── images/              # Static images (showcase, wild, logos, branding)
├── downloads/           # Downloadable files (3D print cases)
└── .well-known/         # Lightning Address & NIP-05 Nostr verification

tools/
└── admin/               # Content management admin panel (not deployed)
```

## Pages

| Section | Routes | Description |
|---------|--------|-------------|
| Home | `/` | Landing page with hero, features, testimonials |
| About | `/about`, `/about/origin-story` | Project info & history |
| Build | `/build`, `/build/classic`, `/build/p1`, `/build/lnbits`, `/build/cases`, `/build/wifi-qr`, `/build/lnurl-qr` | Build guides & documentation |
| Community | `/community`, `/community/bitcoinkids`, `/community/credits`, `/community/educators`, `/community/wild`, `/community/branding`, `/community/zapmypiggy` | Community hub & programs |
| Help | `/help`, `/help/troubleshooting`, `/help/faqs` | Support & troubleshooting |
| News | `/news`, `/news/[slug]` | News hub & articles |
| Market | `/market` | Store with Nostr marketplace integration |

## Content

Blog posts and guides live in `src/content/` as Markdown files with frontmatter:

```yaml
---
title: "Post Title"
description: "Brief description"
pubDate: 2024-01-01
heroImage: ./hero.jpeg
---
```

Data files (`src/data/`) store structured content (credits, partners, testimonials) as JSON, managed via the admin tool and synced to the site at build time.

## Integrations

- **Lightning Network** — Lightning Address redirect via LNbits (`/.well-known/lnurlp/oink`)
- **Nostr** — NIP-05 verification (`/.well-known/nostr.json`), NIP-15 marketplace products from Plebeian Market
- **Newsletter** — Buttondown signup form
- **RSS** — Auto-generated feed via `@astrojs/rss`
- **Sitemap** — Auto-generated via `@astrojs/sitemap`

## Admin Tool

A local Express.js admin panel for managing content (not deployed to production):

```bash
npm run admin      # Start admin panel → http://localhost:3000
```

Features:
- Upload & optimize photos (wild, showcase) with Sharp
- Publish news posts
- Manage credits, partners & testimonials
- Nostr profile lookups via Primal relay
- Sync data to website JSON files

## Deployment

The site deploys automatically to Netlify on push to `main`. Pull requests generate deploy previews.

```toml
# netlify.toml
[build]
  command = "npm run build"
  publish = "dist"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request — a deploy preview will be generated automatically

Markdown is linted on commit via Husky:

```bash
npm run lint:md    # Lint markdown files
```

## License

[GNU General Public License v3.0](LICENSE)

## Links

- **Website**: [lightningpiggy.com](https://lightningpiggy.com)
- **GitHub**: [github.com/LightningPiggy](https://github.com/LightningPiggy)
- **Telegram**: [Community Group](https://t.me/+Y2zSiQELdXxhZDlk)
- **Market**: [lightningpiggy.com/market](https://lightningpiggy.com/market)
