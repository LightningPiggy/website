# LightningPiggy Website

Blog and content website for LightningPiggy built with Astro.

## Tech Stack

- **Framework**: Astro
- **Styling**: Tailwind CSS (`@astrojs/tailwind`), global styles in `src/styles/global.css`
- **Content**: Markdown/MDX files in `src/content/`

## Project Structure

```
src/
  components/        # Reusable Astro/UI components
  content/           # Content collections (news, guides, pages)
  content.config.ts  # Content collection schemas
  data/              # Structured data used by pages/components
  layouts/           # Page layouts
  lib/               # Shared helpers/utilities
  pages/             # Route pages
  styles/            # Global styles (global.css)
public/              # Static assets (images, fonts)
tools/admin/         # Admin server (Node, port 3000)
astro.config.mjs     # Astro configuration
```

## Commands

```bash
npm install      # Install dependencies
npm run dev      # Start dev server (localhost:4321)
npm run build    # Build for production
npm run preview  # Preview production build
npm run admin    # Start the admin by hand (only if its launch agent isn't installed)
npm run lint:md  # Lint & auto-fix Markdown in content/ and archive/
```

## Content

Content is split across three collections (see `src/content.config.ts` for the full schemas):

- `src/content/news/<slug>/index.md` — news posts (requires `pubDate`; supports `tags`, `category`, `url`)
- `src/content/guides/<slug>/index.md` — guides
- `src/content/pages/*.md` — standalone pages

`news` and `guides` are folder-based (`index.md` per entry) so co-located images can be
referenced via the `heroImage` field. Example news frontmatter:

```yaml
---
title: "Post Title"
slug: "post-title"
description: "Brief description"
pubDate: 2024-01-01
---
```

All collections require `title` and `slug`. See `src/content.config.ts` for optional fields
(`heroImage`, `updatedDate`, `tags`, `category`, etc.) per collection.

## Startup

On session start:

1. `preview_start` with name `web-lightningpiggy` (Astro dev server on port 4321). If port
   4321 is already in use by this project's `astro dev` (the Lightning Piggy Admin app starts
   it), `navigate` to <http://localhost:4321> instead.
2. The admin (port 3000) runs as a macOS launch agent: it starts at login and launchd restarts
   it if it stops. Don't `preview_start` it; `navigate` to <http://localhost:3000>. Manage it with
   `tools/admin/ops/admin-agent.sh status|restart|log` (run from a normal terminal; restart
   after pulling admin changes).

## Development Notes

- Use Astro components (`.astro`) for static content
- Use framework components only when interactivity is needed
- Images should be optimized and placed in `src/assets/` for processing or `public/` for static serving
