import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getBilling, hasAccess, requireOperator } from '../_lib/guard.js';
import { query } from '../_lib/db.js';
import { noStore, sameOrigin } from '../_lib/session.js';
import { RESERVED_SUBDOMAINS, ROOT_DOMAIN, SITE_COLUMNS, type SiteRow } from '../_lib/tenant.js';

/**
 * GET /api/sites/mine → the operator's site (or null)
 * PUT /api/sites/mine { name, subdomain, accent, theme, derivAppId, markup } → create/update + go live
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
  if (req.method === 'PUT' && !sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  const op = await requireOperator(req, res);
  if (!op) return;
  const operatorId = op.id;

  try {
    if (req.method === 'GET') {
      const [site] = await query<SiteRow>(`select ${SITE_COLUMNS} from sites where operator_id = $1`, [operatorId]);
      return res.status(200).json({ site: site ? toClient(site) : null, rootDomain: ROOT_DOMAIN });
    }

    const b = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const subdomain = typeof b.subdomain === 'string' ? b.subdomain.trim().toLowerCase() : '';
    const accent = typeof b.accent === 'string' ? b.accent : '';
    const theme = b.theme === 'dark' ? 'dark' : 'light';
    const appId = typeof b.derivAppId === 'string' ? b.derivAppId.trim() : '';
    const markup = typeof b.markup === 'number' ? Math.round(b.markup * 2) / 2 : NaN;

    if (name.length < 2 || name.length > 40) errors.name = 'Use 2 to 40 characters';
    else if (/deriv|binary/i.test(name)) errors.name = 'Deriv does not allow "Deriv" or "Binary" in brand names';
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(subdomain)) errors.subdomain = '3 to 40 letters, numbers or dashes';
    else if (RESERVED_SUBDOMAINS.has(subdomain) || /deriv|binary/.test(subdomain)) errors.subdomain = 'This address is not available';
    if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) errors.accent = 'Pick a colour';
    if (!/^[A-Za-z0-9_-]{2,64}$/.test(appId)) errors.derivAppId = 'Paste the App ID from your Deriv app';
    else if (appId === process.env.DERIV_APP_ID) errors.derivAppId = 'Use your own Deriv app, not Mwasya\'s, so markup is paid to you';
    if (!(markup >= 0 && markup <= 3)) errors.markup = 'Markup must be 0% to 3%';
    if (Object.keys(errors).length) return res.status(422).json({ error: 'invalid_site', errors });

    if (!hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });

    const taken = await query(`select 1 from sites where subdomain = $1 and operator_id <> $2`, [subdomain, operatorId]);
    if (taken.length) return res.status(409).json({ error: 'subdomain_taken', errors: { subdomain: 'Someone already uses this address' } });

    const [site] = await query<SiteRow>(
      `insert into sites (operator_id, name, subdomain, accent, theme, deriv_app_id, markup)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (operator_id) do update set name = excluded.name, subdomain = excluded.subdomain, accent = excluded.accent,
         theme = excluded.theme, deriv_app_id = excluded.deriv_app_id, markup = excluded.markup, status = 'live', updated_at = now()
       returning ${SITE_COLUMNS}`,
      [operatorId, name, subdomain, accent, theme, appId, markup],
    );
    return res.status(200).json({ site: toClient(site), rootDomain: ROOT_DOMAIN });
  } catch (e) {
    console.error('sites/mine', e);
    return res.status(500).json({ error: 'server_error' });
  }
}

function toClient(s: SiteRow) {
  return {
    name: s.name, subdomain: s.subdomain, accent: s.accent, theme: s.theme, derivAppId: s.deriv_app_id,
    markup: Number(s.markup), status: s.status, url: `https://${s.subdomain}.${ROOT_DOMAIN}`,
  };
}
