import type { BotSpec } from '../shared/botSpec';

export interface SiteBranding {
  name: string; subdomain: string; accent: string; theme: 'light' | 'dark'; appId: string;
  template?: string; layout?: string; features?: string[]; tagline?: string | null; logoUrl?: string | null;
}
export interface Announcement { id: string; title: string; body: string; created_at: string }
export interface SiteVideo { id: string; title: string; youtube_id: string }
export interface PublishedBot { id: string; name: string; spec: BotSpec; risk: 'low' | 'medium' | 'high'; updated_at: string }

export type Tenant =
  | { kind: 'platform'; appId: string | null; earningsScope?: boolean }
  | { kind: 'site'; site: SiteBranding; bots: PublishedBot[]; xmlBots?: { id: string; name: string; description: string }[]; announcements?: Announcement[]; videos?: SiteVideo[] }
  | { kind: 'held' } // owner suspended or unpaid: the site only shows its loading screen
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
