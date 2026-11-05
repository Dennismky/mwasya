import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  Logo: () => <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={2.6} aria-hidden="true"><path d="M4 19V6l8 9 8-9v13" /></svg>,
  Arrow: () => <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  Check: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>,
  Lock: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  Shield: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /></svg>,
  Key: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5l3 3L22 7l-3-3" /></svg>,
  Globe: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>,
  Window: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>,
  Chip: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="7" y="7" width="10" height="10" rx="2" /></svg>,
  Send: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z" /></svg>,
  Coin: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M15 9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v2M12 16v2" /></svg>,
  Code: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>,
  Users: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></svg>,
  Card: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></svg>,
  Help: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg>,
  Gear: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.3 7.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  Logout: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>,
  Upload: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>,
  Download: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>,
  Chart: () => <svg width="20" height="20" viewBox="0 0 24 24" {...stroke} aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
};

export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark"><Icon.Logo /></span>
      Mwasya
    </Link>
  );
}

export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border)' }}>
      <div className="container stack" style={{ padding: '48px 24px 32px', gap: 24 }}>
        <Brand />
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          © {new Date().getFullYear()} Mwasya. Built on the Deriv API.
          Trading derivatives involves risk. Bots and signals follow set rules and do not guarantee outcomes.
        </p>
      </div>
    </footer>
  );
}

export function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <article className="card stack" style={{ gap: 12 }}>
      <span className="icon-tile">{icon}</span>
      <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
      <p className="muted" style={{ fontSize: 15, lineHeight: 1.6 }}>{children}</p>
    </article>
  );
}
