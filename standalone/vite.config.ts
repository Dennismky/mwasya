import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Standalone client site build.
 * Pick the client with the SITE environment variable (file name in standalone/sites, without .json):
 *   SITE=example npm run build   (inside the standalone folder)
 * The settings are published as /site.json (what the shared client-site code reads via /api/site),
 * and the client's bot files in sites/<SITE>/bots/*.xml are published as /bots/<file>.xml.
 */
const here = dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.SITE ?? 'example').trim();
if (!/^[a-z0-9-]{2,40}$/.test(SITE)) throw new Error(`SITE must be a settings file name like "example" (got "${SITE}")`);
const file = resolve(here, 'sites', `${SITE}.json`);
if (!existsSync(file)) throw new Error(`No settings file: standalone/sites/${SITE}.json`);

interface SiteFile {
  name: string; slug?: string; tagline?: string; accent?: string; theme?: 'light' | 'dark'; layout?: string; template?: string;
  logo?: string; features?: string[]; freeBots?: { id: string; name: string; description?: string }[];
  announcements?: { id: string; title: string; body: string; date: string }[];
}
const cfg = JSON.parse(readFileSync(file, 'utf8')) as SiteFile;
if (!cfg.name) throw new Error(`standalone/sites/${SITE}.json needs a "name"`);

// Same shape as the Mwasya platform's /api/site, so the shared screens work unchanged.
const tenant = {
  kind: 'site',
  site: {
    name: cfg.name, subdomain: cfg.slug || SITE, accent: cfg.accent || '#1F4FD1', theme: cfg.theme === 'dark' ? 'dark' : 'light',
    appId: process.env.DERIV_APP_ID || '', template: cfg.template || 'bothub', layout: cfg.layout || 'classic',
    features: cfg.features ?? [], tagline: cfg.tagline ?? null, logoUrl: cfg.logo || null,
  },
  bots: [],
  xmlBots: (cfg.freeBots ?? []).map((b) => ({ id: b.id, name: b.name, description: b.description ?? '' })),
  announcements: (cfg.announcements ?? []).map((a) => ({ id: a.id, title: a.title, body: a.body, created_at: new Date(a.date).toISOString() })),
};

function siteFiles(): Plugin {
  return {
    name: 'standalone-site-files',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'site.json', source: JSON.stringify(tenant) });
      const bots = resolve(here, 'sites', SITE, 'bots');
      if (existsSync(bots)) {
        for (const f of readdirSync(bots).filter((x) => /^[\w-]+\.xml$/.test(x))) {
          this.emitFile({ type: 'asset', fileName: `bots/${f}`, source: readFileSync(resolve(bots, f), 'utf8') });
        }
      }
    },
    transformIndexHtml: (html) => html.replace('%SITE_NAME%', cfg.name.replace(/[<>&"]/g, '')),
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), siteFiles()],
  // The shared screens live in ../src; allow Vite to read them.
  server: { fs: { allow: [resolve(here, '..')] } },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, sourcemap: false },
});
