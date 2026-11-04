import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const MAX_MARKUP = 3; // percent
export const ACCENTS = [
  { hex: '#1F4FD1', name: 'Royal blue' },
  { hex: '#0B1F3A', name: 'Navy' },
  { hex: '#0E7C66', name: 'Teal' },
  { hex: '#3B3FB6', name: 'Indigo' },
  { hex: '#0F6E9E', name: 'Ocean' },
  { hex: '#2D3748', name: 'Graphite' },
] as const;

export interface SiteConfig {
  name: string;
  subdomain: string;
  accent: string;
  theme: 'light' | 'dark';
  derivAppId: string;
  markup: number;
  domainMode: 'sub' | 'custom';
  customDomain: string;
}

interface SiteStore extends SiteConfig {
  update: (patch: Partial<SiteConfig>) => void;
  reset: () => void;
}

const defaults: SiteConfig = {
  name: 'YourBrand',
  subdomain: 'yourbrand',
  accent: ACCENTS[0].hex,
  theme: 'light',
  derivAppId: '',
  markup: MAX_MARKUP,
  domainMode: 'sub',
  customDomain: '',
};

export const isBadBrandName = (name: string) => /deriv/i.test(name);
export const cleanSubdomain = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
export const clampMarkup = (n: number) => Math.min(MAX_MARKUP, Math.max(0, Math.round(n * 2) / 2));

/**
 * Draft site settings. Persisted locally for now — this moves to Supabase
 * (row-level security per operator) when the backend lands.
 * Secrets (affiliate token, Telegram token) are intentionally NOT stored here.
 */
export const useSiteConfig = create<SiteStore>()(
  persist(
    (set) => ({
      ...defaults,
      update: (patch) =>
        set((s) => ({
          ...patch,
          markup: patch.markup !== undefined ? clampMarkup(patch.markup) : s.markup,
        })),
      reset: () => set(defaults),
    }),
    { name: 'mw_site_draft' },
  ),
);
