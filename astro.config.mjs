import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://lightningpiggy.com',
  integrations: [mdx(), sitemap(), tailwind()],
  vite: { cacheDir: "/tmp/vite-cache-lp4" },
  // Help moved onto the build page; keep the old /help URL working.
  redirects: {
    '/help': '/build#help',
  },
});
