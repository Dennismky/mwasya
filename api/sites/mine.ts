import type { VercelRequest, VercelResponse } from '@vercel/node';
import { audit, getBilling, hasAccess, rateLimit, requireOperator } from '../_lib/guard.js';
import { addDomain, checkDomain, domainsConfigured, removeDomain } from '../_lib/vercelDomains.js';
import { query } from '../_lib/db.js';
import { noStore, sameOrigin } from '../_lib/session.js';
import { RESERVED_SUBDOMAINS, ROOT_DOMAIN, SITE_COLUMNS, type SiteRow } from '../_lib/tenant.js';

/**
 * GET /api/sites/mine → the operator's site (or null)
 * PUT /api/sites/mine { name, subdomain, accent, theme, derivAppId, markup } → create/update + go live
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  const op = await requireOperator(req, res);
  if (!op) return;
  const operatorId = op.id;

  try {
    if (req.query.action === 'domain') return await domain(req, res, operatorId, hasAccess(op, await getBilling()));
    if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
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
    markup: Number(s.markup), status: s.status,
    customDomain: s.custom_domain, domainStatus: s.domain_status,
    url: s.custom_domain && s.domain_status === 'verified' ? `https://${s.custom_domain}` : `https://${s.subdomain}.${ROOT_DOMAIN}`,
    subdomainUrl: `https://${s.subdomain}.${ROOT_DOMAIN}`,
  };
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** /api/sites/mine?action=domain — POST { domain } connect · GET re-check DNS · DELETE disconnect. */
async function domain(req: VercelRequest, res: VercelResponse, operatorId: string, canPublish: boolean) {
  const [site] = await query<SiteRow>(`select ${SITE_COLUMNS} from sites where operator_id = $1`, [operatorId]);
  if (!site) return res.status(409).json({ error: 'Publish your site first, then connect a domain.' });
  if (!domainsConfigured()) return res.status(503).json({ error: 'Custom domains are not enabled yet. Ask the platform owner.' });

  if (req.method === 'POST') {
    if (!canPublish) return res.status(402).json({ error: 'payment_required' });
    if (!(await rateLimit(`domain:${operatorId}`, 10, 3600))) return res.status(429).json({ error: 'Too many changes. Try again later.' });
    let d = String((req.body ?? {}).domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (d.length > 253 || !DOMAIN_RE.test(d)) return res.status(422).json({ error: 'Enter a domain like trade.yourbrand.com or yourbrand.com' });
    if (d === ROOT_DOMAIN || d.endsWith(`.${ROOT_DOMAIN}`) || /(^|\.)(vercel\.app|deriv\.com|deriv\.me|binary\.com)$/.test(d)) {
      return res.status(422).json({ error: 'This domain cannot be used' });
    }
    const taken = await query(`select 1 from sites where custom_domain = $1 and operator_id <> $2`, [d, operatorId]);
    if (taken.length) return res.status(409).json({ error: 'Another site already uses this domain' });
    if (site.custom_domain && site.custom_domain !== d) await removeDomain(site.custom_domain).catch(() => undefined);
    const st = await addDomain(d);
    const status = st.error ? 'error' : st.verified && st.configured ? 'verified' : 'pending';
    await query(`update sites set custom_domain = $2, domain_status = $3, domain_checked_at = now(), updated_at = now() where operator_id = $1`, [operatorId, d, status]);
    await audit(operatorId, 'site.domain.add', operatorId, { domain: d });
    return res.status(200).json({ domain: d, status, ...st });
  }
  if (!site.custom_domain) return res.status(200).json({ domain: null, status: 'none', records: [] });
  if (req.method === 'GET') {
    const st = await checkDomain(site.custom_domain);
    const status = st.error ? 'error' : st.verified && st.configured ? 'verified' : 'pending';
    await query(`update sites set domain_status = $2, domain_checked_at = now() where operator_id = $1`, [operatorId, status]);
    return res.status(200).json({ domain: site.custom_domain, status, ...st });
  }
  if (req.method === 'DELETE') {
    await removeDomain(site.custom_domain).catch(() => undefined);
    await query(`update sites set custom_domain = null, domain_status = 'none', updated_at = now() where operator_id = $1`, [operatorId]);
    await audit(operatorId, 'site.domain.remove', operatorId, { domain: site.custom_domain });
    return res.status(204).end();
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
