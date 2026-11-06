import type { VercelRequest } from '@vercel/node';
import { query } from './db.js';

/**
 * Which site is this request for?
 * - mwasya.site, www., *.vercel.app, localhost → the operator studio ("platform")
 * - <sub>.mwasya.site → that operator's trader site
 */
export const ROOT_DOMAIN = 'mwasya.site';
export const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'studio', 'mail', 'sites', 'auth', 'help', 'docs', 'status', 'blog', 'dashboard', 'login', 'static', 'cdn']);

export interface SiteRow {
  id: string;
  operator_id: string;
  name: string;
  subdomain: string;
  accent: string;
  theme: 'light' | 'dark';
  deriv_app_id: string;
  markup: string;
  status: 'live' | 'paused';
  custom_domain: string | null;
  domain_status: 'none' | 'pending' | 'verified' | 'error';
}
export const SITE_COLUMNS = 'id, operator_id, name, subdomain, accent, theme, deriv_app_id, markup, status, custom_domain, domain_status';

export function requestHost(req: VercelRequest): string {
  const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, '');
}

/** `held`: the site exists but its owner is suspended or unpaid. It is never served; the address just keeps loading. */
export type Tenant = { kind: 'platform'; host: string } | { kind: 'site'; host: string; site: SiteRow } | { kind: 'held'; host: string } | { kind: 'unknown'; host: string };

/** Hosts that serve the mentor studio itself. */
export function isPlatformHost(host: string): boolean {
  return host === ROOT_DOMAIN || host === `www.${ROOT_DOMAIN}` || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app');
}

// Served only while the operator is active and has access (owner, free pricing, or paid_until in the future).
const LIVE_SITE = `
  from sites s join operators o on o.id = s.operator_id
 where s.status = 'live' and o.status = 'active'
   and (o.role = 'owner' or o.paid_until > now()
        or coalesce((select (value->>'price_kes')::numeric from settings where key = 'billing'), 0) <= 0)`;
const S_COLS = SITE_COLUMNS.split(', ').map((c) => 's.' + c).join(', ');

/** A live site matching `where` exists, but LIVE_SITE refused it: its owner is suspended or has not paid. */
async function held(where: string, args: unknown[], host: string): Promise<Tenant> {
  const [row] = await query<{ one: number }>(`select 1 as one from sites s join operators o on o.id = s.operator_id where s.status = 'live' and o.role <> 'owner' and ${where} limit 1`, args);
  return row ? { kind: 'held', host } : { kind: 'unknown', host };
}

export async function resolveTenant(req: VercelRequest): Promise<Tenant> {
  const host = requestHost(req);
  if (isPlatformHost(host)) return { kind: 'platform', host };
  if (!process.env.DATABASE_URL) return { kind: 'unknown', host };

  // <sub>.mwasya.site — and, for local testing only, <sub>.localhost (browsers send *.localhost to your own computer).
  const local = host.endsWith('.localhost') && process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_ENV !== 'preview';
  if (host.endsWith(`.${ROOT_DOMAIN}`) || local) {
    const sub = local ? host.slice(0, -'.localhost'.length) : host.slice(0, -(ROOT_DOMAIN.length + 1));
    if (sub.includes('.')) return { kind: 'unknown', host };
    const [site] = await query<SiteRow>(`select ${S_COLS} ${LIVE_SITE} and s.subdomain = $1`, [sub]);
    return site ? { kind: 'site', host, site } : held('s.subdomain = $1', [sub], host);
  }

  // A mentor's own domain (e.g. statefx.pro or trade.brand.com). www.<domain> maps to the same site.
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  const [site] = await query<SiteRow>(
    `select ${S_COLS} ${LIVE_SITE} and s.custom_domain in ($1, $2) and s.domain_status <> 'none' limit 1`, [host, bare]);
  return site ? { kind: 'site', host, site } : held(`s.custom_domain in ($1, $2) and s.domain_status <> 'none'`, [host, bare], host);
}
