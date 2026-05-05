# LightningPiggy Website

Blog and content website for LightningPiggy built with Astro.

## Tech Stack

- **Framework**: Astro
- **Styling**: (TBD - CSS/Tailwind/etc)
- **Content**: Markdown/MDX files in `src/content/`

## Project Structure

```
src/
  components/    # Reusable Astro/UI components
  content/       # Blog posts and content collections
  layouts/       # Page layouts
  pages/         # Route pages
  styles/        # Global styles
public/          # Static assets (images, fonts)
astro.config.mjs # Astro configuration
```

## Commands

```bash
npm install      # Install dependencies
npm run dev      # Start dev server (localhost:4321)
npm run build    # Build for production
npm run preview  # Preview production build
```

## Content

Blog posts go in `src/content/blog/` as Markdown or MDX files with frontmatter:

```yaml
---
title: "Post Title"
description: "Brief description"
pubDate: 2024-01-01
---
```

## Startup

On session start, always start both preview servers:
1. `preview_start` with name `dev` (Astro dev server on port 4321)
2. `preview_start` with name `admin` (Admin server on port 3000)

## Development Notes

- Use Astro components (`.astro`) for static content
- Use framework components only when interactivity is needed
- Images should be optimized and placed in `src/assets/` for processing or `public/` for static serving
