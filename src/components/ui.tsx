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
          © {new Date().getFullYear()} Mwasya. Mwasya is an independent platform and is not affiliated with or endorsed by Deriv.
          Trading derivatives carries a high level of risk, and you can lose all of your stake. Bots and signals do not guarantee profit.
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
