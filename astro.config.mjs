import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://lightningpiggy.com',
  integrations: [mdx(), sitemap(), tailwind()],
  vite: { cacheDir: "/tmp/vite-cache-lp4" },
  // Help moved onto the build page; keep the old /help URL working.
  // The standalone NIP-05 page was folded into /market; keep its old URL working.
  redirects: {
    '/help': '/build#help',
    '/market/nip05': '/market',
  },
});
