import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { LANGUAGES, useLang, useT, type Lang } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { Icon } from './ui';
import DuesBell from './DuesBell';
import { Loader } from './Loader';

type NavKey = Parameters<ReturnType<typeof useT>>[0];
const NAV: { to: string; key: NavKey; icon: ReactNode; soon?: boolean; section?: string; owner?: boolean }[] = [
  { to: '/app', key: 'nav.overview', icon: <Icon.Chart />, section: 'BUILD & MANAGE' },
  { to: '/sites', key: 'nav.sites', icon: <Icon.Globe /> },
  { to: '/forge', key: 'nav.forge', icon: <Icon.Chip /> },
  { to: '/xml-bots', key: 'nav.xml', icon: <Icon.Code /> },
  { to: '/commissions', key: 'nav.commissions', icon: <Icon.Coin /> },
  { to: '/network', key: 'nav.network', icon: <Icon.Users />, section: 'ACCOUNT' },
  { to: '/fees', key: 'nav.fees', icon: <Icon.Coin />, owner: true },
  { to: '/billing', key: 'nav.billing', icon: <Icon.Card /> },
  { to: '/support', key: 'nav.support', icon: <Icon.Help /> },
  { to: '/settings', key: 'nav.settings', icon: <Icon.Gear /> },
  { to: '/signals', key: 'nav.signals', icon: <Icon.Send />, soon: true },
];

/** Logged-in area: auth guard + sidebar + top bar. Pages render in <Outlet />. */
export default function AppShell() {
  return (
    <AuthProvider live={false}>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const auth = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const t = useT();
  const { lang, setLang } = useLang();
  const { theme, toggle } = useTheme();

  // Language follows the operator's saved profile on first load.
  useEffect(() => {
    if (!auth.operator) return;
    fetch('/api/settings/profile', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { profile?: { language?: Lang } } | null) => { const l = j?.profile?.language; if (l && l !== useLang.getState().lang) setLang(l); })
      .catch(() => undefined);
  }, [auth.operator, setLang]);
  const changeLang = (l: Lang) => {
    setLang(l);
    if (auth.operator) {
      fetch('/api/settings/profile', { credentials: 'same-origin' }).then((r) => r.json()).then((j) =>
        fetch('/api/settings/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({ ...(j.profile ?? {}), language: l }) })).catch(() => undefined);
    }
  };

  if (auth.status === 'signed-out') {
    return <Navigate to="/" replace state={{ from: location.pathname, error: auth.error }} />;
  }
  if (auth.status === 'checking') {
    return <Loader label="Checking your session" />;
  }

  return (
    <div className={`shell ${open ? 'shell-open' : ''}`}>
      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-brand">
          <span className="brand-mark"><Icon.Logo /></span>
          <div className="stack">
            <b>Mwasya</b>
            <span className="sidebar-sub">{auth.me?.operator.role === 'owner' ? t('nav.owner') : t('nav.studio')}</span>
          </div>
        </div>
        <nav className="stack sidebar-nav" style={{ gap: 2 }}>
          {NAV.filter((n) => !n.owner || auth.me?.operator.role === 'owner').map((n) => (
            <Fragment key={n.to}>
              {n.section && <span className="side-section">{n.section}</span>}
              {n.soon ? (
                <span className="side-link side-link-soon" aria-disabled="true">{n.icon}{t(n.key)}<span className="soon">{t('nav.soon')}</span></span>
              ) : (
                <NavLink to={n.to} end={n.to !== '/sites'} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
                  {n.icon}{t(n.key)}
                </NavLink>
              )}
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="side-row">
            <span>Theme</span>
            <button className={`switch ${theme === 'dark' ? 'on' : ''}`} role="switch" aria-checked={theme === 'dark'} aria-label="Dark theme" onClick={toggle}>
              <span>{theme === 'dark' ? '☾' : '☀'}</span>
            </button>
          </div>
          <label className="side-row">
            <span>{t('nav.language')}</span>
            <span className="row" style={{ alignItems: 'center', gap: 6 }}>
              <Icon.Globe />
              <select className="lang-select" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label={t('nav.language')}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.code.toUpperCase()} · {l.label}</option>)}
              </select>
            </span>
          </label>
          <button className="side-link" style={{ border: 0, background: 'none', width: '100%' }} onClick={auth.signOut}>
            <Icon.Logout />{t('nav.signOut')}
          </button>
          <p className="sidebar-legal">{t('legal.risk')}</p>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          <span style={{ flex: 1 }} />
          <DuesBell />
        </header>
        <main className="shell-content">
          {auth.suspended && (
            <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: '#F5C2BD', marginBottom: 20 }}>
              <span><b>Your account is suspended.</b> Your site is offline and changes are disabled. Contact the person who invited you.</span>
            </div>
          )}
          {!auth.suspended && auth.me?.billing.required && !auth.me.billing.active && location.pathname !== '/billing' && (
            <div className="notice" style={{ marginBottom: 20 }}>
              <span><b>Activate your account</b> to publish your site and invite people.</span>
              <NavLink className="btn btn-primary" to="/billing">Pay with M-Pesa</NavLink>
            </div>
          )}
          {auth.status === 'error' ? <p className="error" role="alert">{auth.error}</p> : <Outlet />}
        </main>
      </div>
      <nav className="bottom-bar" aria-label="Quick navigation">
        {([['/app', 'Home', <Icon.Chart key="i" />], ['/sites', 'Sites', <Icon.Globe key="i" />], ['/forge', 'Bots', <Icon.Chip key="i" />], ['/support', 'Support', <Icon.Help key="i" />]] as const).map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to !== '/sites'} className={({ isActive }) => (isActive ? 'on' : '')}>{icon}<span>{label}</span></NavLink>
        ))}
        <button onClick={() => setOpen(true)}>☰<span>More</span></button>
      </nav>
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
    </div>
  );
}
