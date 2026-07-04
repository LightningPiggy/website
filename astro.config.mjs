import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

// Dev-only: mirror the Netlify `/treasure/*` rewrite (netlify.toml) so the
// pretty /treasure/<naddr> URLs work in `astro dev` too. Astro's dev server
// doesn't read netlify.toml, so without this the treasure detail links would
// 404 locally. It internally rewrites to the query form the page also accepts
// (?naddr=…); the browser URL is left untouched. Production and other static
// hosting rely on the Netlify rewrite instead - this hook only runs in dev.
function treasureDevRewrite() {
  return {
    name: 'treasure-dev-rewrite',
    hooks: {
      'astro:server:setup': ({ server }) => {
        server.middlewares.use((req, _res, next) => {
          const match = (req.url || '').match(/^\/treasure\/(naddr1[0-9a-z]+)\/?(\?.*)?$/i);
          if (match) {
            const search = match[2] || '';
            req.url = '/treasure' + search + (search ? '&' : '?') + 'naddr=' + match[1];
          }
          next();
        });
      },
    },
  };
}

export default defineConfig({
  site: 'https://lightningpiggy.com',
  integrations: [mdx(), sitemap(), tailwind(), treasureDevRewrite()],
  vite: { cacheDir: "/tmp/vite-cache-lp4" },
  // Help moved onto the build page; keep the old /help URL working.
  // The standalone NIP-05 page was folded into /market; keep its old URL working.
  redirects: {
    '/help': '/build#help',
    '/market/nip05': '/market',
  },
});
