import type { BotSpec } from '../shared/botSpec';

export interface SiteBranding { name: string; subdomain: string; accent: string; theme: 'light' | 'dark'; appId: string }
export interface PublishedBot { id: string; name: string; spec: BotSpec; risk: 'low' | 'medium' | 'high'; updated_at: string }

export type Tenant =
  | { kind: 'platform'; appId: string | null }
  | { kind: 'site'; site: SiteBranding; bots: PublishedBot[] }
  | { kind: 'unknown'; host?: string };

let cached: Promise<Tenant> | undefined;

/** Which app is this? Studio (mwasya.site) or an operator's trader site (<sub>.mwasya.site). */
export function loadTenant(): Promise<Tenant> {
  cached ??= fetch('/api/site', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Tenant>) : ({ kind: 'platform', appId: null } as Tenant)))
    .catch(() => ({ kind: 'platform', appId: null }) as Tenant);
  return cached;
}

/** Re-fetch (e.g. after an operator publishes a bot). */
export function reloadTenant(): Promise<Tenant> {
  cached = undefined;
  return loadTenant();
}
