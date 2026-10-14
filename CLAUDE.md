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
npm run dev      # Start dev server (localhost:4321; already running if its launch agent is)
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

The Astro dev server (port 4321) and the admin (port 3000) run as macOS launch agents on the
maintainer's Mac: they start at login and launchd restarts them if they stop. Don't
`preview_start` either one (the port is taken); `navigate` to <http://localhost:4321> and
<http://localhost:3000>. Manage them with `tools/admin/ops/admin-agent.sh status|restart|log
[admin|dev]` from a normal terminal (restart the admin after pulling admin changes, the dev
server after changing dependencies or `astro.config.mjs`). If `status` says they aren't
installed, start them with `preview_start` as before.

## Development Notes

- Use Astro components (`.astro`) for static content
- Use framework components only when interactivity is needed
- Images should be optimized and placed in `src/assets/` for processing or `public/` for static serving
