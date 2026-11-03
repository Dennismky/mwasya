import type { VercelRequest, VercelResponse } from '@vercel/node';
import { query } from './_lib/db.js';
import { resolveTenant } from './_lib/tenant.js';

/**
 * GET /api/site — public. Tells the browser which app it is:
 * - { kind: 'platform', appId }                       → operator studio (mwasya.site)
 * - { kind: 'site', site: {...branding, appId}, bots } → a trader site (<sub>.mwasya.site)
 * - { kind: 'unknown' }                                → no live site at this address
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const t = await resolveTenant(req);
    if (t.kind === 'platform') {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({ kind: 'platform', appId: process.env.DERIV_APP_ID ?? process.env.VITE_DERIV_APP_ID ?? null });
    }
    if (t.kind === 'unknown') {
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json({ kind: 'unknown', host: t.host });
    }
    const bots = await query<{ id: string; name: string; spec: unknown; risk: string; updated_at: string }>(
      `select id, name, spec, risk, updated_at from bots where operator_id = $1 and status = 'published' order by updated_at desc limit 50`,
      [t.site.operator_id],
    );
    const xmlBots = await query<{ id: string; name: string; description: string }>(
      `select id, name, description from xml_bots where operator_id = $1 and status = 'published' order by updated_at desc limit 50`,
      [t.site.operator_id],
    );
    res.setHeader('Cache-Control', 'public, max-age=30');
    return res.status(200).json({
      kind: 'site',
      site: { name: t.site.name, subdomain: t.site.subdomain, accent: t.site.accent, theme: t.site.theme, appId: t.site.deriv_app_id },
      bots,
      xmlBots,
    });
  } catch (e) {
    console.error('site', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
