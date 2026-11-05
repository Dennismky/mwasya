import type { VercelRequest, VercelResponse } from '@vercel/node';
import { query } from './_lib/db.js';
import { resolveTenant } from './_lib/tenant.js';
import { burst } from './_lib/burst.js';

/**
 * GET /api/site — public. Tells the browser which app it is:
 * - { kind: 'platform', appId }                       → operator studio (mwasya.site)
 * - { kind: 'site', site: {...branding, appId}, bots } → a trader site (<sub>.mwasya.site)
 * - { kind: 'unknown' }                                → no live site at this address
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!burst(req, res, 'site', 120)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const t = await resolveTenant(req);
    if (t.kind === 'platform') {
      res.setHeader('Cache-Control', 'public, max-age=300');
      // DERIV_EARNINGS_SCOPE=1 once application_read is enabled on Mwasya's Deriv app → studio logins also read markup stats.
      return res.status(200).json({ kind: 'platform', appId: process.env.DERIV_APP_ID ?? process.env.VITE_DERIV_APP_ID ?? null, earningsScope: process.env.DERIV_EARNINGS_SCOPE === '1' });
    }
    if (t.kind === 'unknown') {
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json({ kind: 'unknown', host: t.host });
    }
    const bots = await query<{ id: string; name: string; spec: unknown; risk: string; updated_at: string }>(
      `select id, name, spec, risk, updated_at from bots where operator_id = $1 and status = 'published' order by updated_at desc limit 50`,
      [t.site.operator_id],
    );
    // Builder config: design, which tabs show, tagline, logo, and which free bots (catalog + own) appear.
    const [cfg] = await query<{ template: string; layout: string; features: string[]; free_bots: string[]; tagline: string | null; has_logo: boolean; updated_at: string }>(
      `select template, layout, features, free_bots, tagline, (logo is not null) as has_logo, updated_at from sites where id = $1`, [t.site.id]);
    const picked = Array.isArray(cfg?.free_bots) ? cfg.free_bots : [];
    const xmlBots = await query<{ id: string; name: string; description: string }>(
      picked.length
        ? `select b.id, b.name, b.description from xml_bots b join operators o on o.id = b.operator_id
            where b.id = any($2::uuid[]) and ((b.catalog and o.role = 'owner') or (b.operator_id = $1)) order by b.name limit 200`
        : `select id, name, description from xml_bots where operator_id = $1 and status = 'published' order by updated_at desc limit 50`,
      picked.length ? [t.site.operator_id, picked] : [t.site.operator_id],
    );
    // EDIT HERE: how many announcements clients receive (limit 20, newest first).
    const announcements = await query<{ id: string; title: string; body: string; created_at: string }>(
      `select id, title, body, created_at from site_announcements where site_id = $1 order by created_at desc limit 20`, [t.site.id],
    ).catch(() => []);
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json({
      kind: 'site',
      site: {
        name: t.site.name, subdomain: t.site.subdomain, accent: t.site.accent, theme: t.site.theme, appId: t.site.deriv_app_id,
        template: cfg?.template ?? 'bothub', layout: cfg?.layout ?? 'classic', features: cfg?.features ?? [], tagline: cfg?.tagline ?? null,
        logoUrl: cfg?.has_logo ? `/api/sites/logo?id=${t.site.id}&v=${Date.parse(cfg.updated_at)}` : null,
      },
      bots,
      xmlBots,
      announcements,
    });
  } catch (e) {
    console.error('site', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
