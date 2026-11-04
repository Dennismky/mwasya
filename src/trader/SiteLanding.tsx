import { Reveal } from '../components/motion';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { getSession, safeReturnPath, startLogin } from '../lib/derivAuth';
import type { SiteBranding } from '../lib/tenant';
import { templateOf } from '../shared/templates';
import { Ticker } from './Ticker';

const FEATURE_CARDS: { f: string; title: string; text: string; icon: ReactNode }[] = [
  { f: 'bots', title: 'Ready-made bots', text: 'Pick a bot, press Run. Every bot stops at its own profit and loss limits.', icon: <Icon.Chip /> },
  { f: 'freebots', title: 'Free bot files', text: 'Download Deriv Bot strategies and load them in one tap.', icon: <Icon.Code /> },
  { f: 'manual', title: 'Trade by hand', text: 'Rise/Fall, Digits, Accumulators, Multipliers and more, on a live chart.', icon: <Icon.Window /> },
  { f: 'charts', title: 'Live charts', text: 'Every synthetic index, streaming tick by tick.', icon: <Icon.Chart /> },
  { f: 'analysis', title: 'Analysis tools', text: 'Last-digit stats, even/odd and over/under at a glance.', icon: <Icon.Help /> },
  { f: 'risk', title: 'Risk calculator', text: 'See how far a losing streak can go before you trade.', icon: <Icon.Shield /> },
];

/** `/` on a trading site: public welcome page. Logged-in clients go straight to the platform. */
export default function SiteLanding({ site }: { site: SiteBranding }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState(state.error ?? '');
  const t = templateOf(site.template);
  const dark = site.theme === 'dark';
  const has = (f: string) => !site.features?.length || site.features.includes(f);

  useEffect(() => {
    getSession().then((s) => (s.loggedIn ? navigate(returnTo, { replace: true }) : setChecking(false))).catch(() => setChecking(false));
  }, [navigate, returnTo]);

  const go = (signup: boolean) => {
    setBusy(signup ? 'signup' : 'login'); setError('');
    startLogin({ signup, returnTo }).catch((e: Error) => { setError(e.message); setBusy(null); });
  };

  const logo = site.logoUrl
    ? <img className="sl-logo" src={site.logoUrl} alt="" />
    : <span className="sl-logo" style={{ background: site.accent }}>{site.name.slice(0, 2).toUpperCase()}</span>;

  return (
    <div className={`sl ${dark ? 'sl-dark' : ''}`} style={{ '--accent': site.accent } as CSSProperties}>
      <header className="sl-head">
        {logo}
        <div className="stack" style={{ lineHeight: 1.15, minWidth: 0 }}>
          <b>{site.name}</b>
          <span className="sl-sub">Built on the Deriv API</span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn sl-ghost" disabled={busy !== null || checking} onClick={() => go(false)}>Log in</button>
        <button className="btn sl-cta" disabled={busy !== null || checking} onClick={() => go(true)}>Sign up</button>
      </header>
      {has('charts') && <Ticker />}

      <main className="sl-main">
        <section className="sl-hero">
          <span className="sl-pill">Deriv bots, trading tools and live markets in one place</span>
          <h1>Welcome to <span>{site.name}</span></h1>
          <p>{site.tagline || t.hero}</p>
          <div className="sl-actions">
            <button className="btn sl-cta sl-big" disabled={busy !== null || checking} onClick={() => go(false)}>
              {busy === 'login' ? 'Opening Deriv…' : 'Log in and trade'} <Icon.Arrow />
            </button>
            <button className="btn sl-ghost sl-big" disabled={busy !== null || checking} onClick={() => go(true)}>
              {busy === 'signup' ? 'Opening Deriv…' : 'Create a free Deriv account'}
            </button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <ul className="sl-trust">
            <li><Icon.Shield /> Your money stays in your Deriv account</li>
            <li><Icon.Lock /> We can never withdraw your funds</li>
            <li><Icon.Check /> Practise free on a demo account</li>
          </ul>
        </section>

        <Reveal as="section" className="sl-grid">
          {FEATURE_CARDS.filter((c) => has(c.f)).map((c) => (
            <article key={c.f} className="sl-card spot">
              <span className="sl-icon">{c.icon}</span>
              <b>{c.title}</b>
              <p>{c.text}</p>
            </article>
          ))}
        </Reveal>

        <section className="sl-steps" aria-label="How it works">
          <h2>Start in three steps</h2>
          <Reveal as="ol" stagger={110}>
            <li><b>Create your Deriv account</b><span>Free, on Deriv's own secure page.</span></li>
            <li><b>Log in here</b><span>One tap. We never see your password.</span></li>
            <li><b>Practise on demo</b><span>Try bots and tools with virtual money first.</span></li>
          </Reveal>
        </section>
      </main>

      <footer className="sl-foot">
        <p>Trading derivatives carries a high level of risk, and you can lose all of your stake. Bots and tools do not guarantee profit. Past results don't predict future results.</p>
        <p>© {new Date().getFullYear()} {site.name}. Built on the Deriv API.</p>
      </footer>
    </div>
  );
}
