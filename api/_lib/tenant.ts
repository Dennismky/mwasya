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
}
export const SITE_COLUMNS = 'id, operator_id, name, subdomain, accent, theme, deriv_app_id, markup, status';

export function requestHost(req: VercelRequest): string {
  const raw = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase();
  return raw.replace(/:\d+$/, '');
}

export type Tenant = { kind: 'platform'; host: string } | { kind: 'site'; host: string; site: SiteRow } | { kind: 'unknown'; host: string };

export async function resolveTenant(req: VercelRequest): Promise<Tenant> {
  const host = requestHost(req);
  const sub = host.endsWith(`.${ROOT_DOMAIN}`) ? host.slice(0, -(ROOT_DOMAIN.length + 1)) : null;
  if (!sub || sub === 'www' || sub.includes('.')) return { kind: 'platform', host };
  if (!process.env.DATABASE_URL) return { kind: 'unknown', host };
  const [site] = await query<SiteRow>(`select ${SITE_COLUMNS} from sites where subdomain = $1 and status = 'live'`, [sub]);
  return site ? { kind: 'site', host, site } : { kind: 'unknown', host };
}
