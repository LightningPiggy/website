import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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

// Dev-only: the always-on dev server (the launch agent in
// tools/admin/ops/run-devserver.sh, which sets LP_LAUNCH_AGENT) must serve on
// 4321, where the admin previews it. Astro quietly moves to the next free port
// when 4321 is taken, also when it restarts itself after a config change, so
// it exits instead and launchd tries again in 10 s once 4321 is free.
function launchAgentPortGuard() {
  return {
    name: 'lp-launch-agent-port-guard',
    hooks: {
      'astro:server:start': ({ address }) => {
        if (process.env.LP_LAUNCH_AGENT && address.port !== 4321) {
          console.error(`[lp] the launch agent's dev server must be on port 4321, not ${address.port}; exiting so launchd retries`);
          process.exit(1);
        }
      },
    },
  };
}

// Vite's dependency cache lives outside the project (in /tmp), one per
// checkout: the main checkout's always-on dev server and a worktree's dev
// server sharing one cache would keep deleting each other's optimised deps.
const ROOT_KEY = createHash('sha1').update(fileURLToPath(new URL('.', import.meta.url))).digest('hex').slice(0, 8);

export default defineConfig({
  site: 'https://lightningpiggy.com',
  integrations: [
    mdx(),
    // The newsletter confirm pages are only reached from emails.
    sitemap({ filter: (page) => !/\/newsletter-confirm(ed)?\/?$/.test(page) }),
    tailwind(),
    treasureDevRewrite(),
    launchAgentPortGuard(),
  ],
  vite: {
    cacheDir: `/tmp/vite-cache-lp4-${ROOT_KEY}`,
    // Worktrees under .claude/ are separate checkouts; their changes (an
    // astro.config.mjs edit, say) must not restart this one's dev server.
    server: { watch: { ignored: ['**/.claude/**'] } },
  },
  // Help moved onto the build page; keep the old /help URL working.
  // The standalone NIP-05 page was folded into /market; keep its old URL working.
  redirects: {
    '/help': '/build#help',
    '/market/nip05': '/market',
  },
});
