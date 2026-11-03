import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { Icon } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; soon?: boolean }[] = [
  { to: '/app', label: 'Overview', icon: <Icon.Chart /> },
  { to: '/forge', label: 'Bot Forge', icon: <Icon.Chip /> },
  { to: '/setup', label: 'My site', icon: <Icon.Globe /> },
  { to: '/signals', label: 'Signals', icon: <Icon.Send />, soon: true },
  { to: '/earnings', label: 'Earnings', icon: <Icon.Coin />, soon: true },
];

/** Logged-in area: auth guard + sidebar + top bar. Pages render in <Outlet />. */
export default function AppShell() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const auth = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  if (auth.status === 'signed-out') {
    return <Navigate to="/" replace state={{ from: location.pathname, error: auth.error }} />;
  }
  if (auth.status === 'checking') {
    return <div className="shell-loading" aria-live="polite"><span className="spinner" /> Checking your session…</div>;
  }

  return (
    <div className={`shell ${open ? 'shell-open' : ''}`}>
      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-brand">
          <span className="brand-mark"><Icon.Logo /></span>
          <div className="stack">
            <b>Mwasya</b>
            <span className="sidebar-sub">OPERATOR STUDIO</span>
          </div>
        </div>
        <nav className="stack" style={{ gap: 4 }}>
          {NAV.map((n) => n.soon ? (
            <span key={n.to} className="side-link side-link-soon" aria-disabled="true">{n.icon}{n.label}<span className="soon">Soon</span></span>
          ) : (
            <NavLink key={n.to} to={n.to} end className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
              {n.icon}{n.label}
            </NavLink>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <button className="side-link" style={{ border: 0, background: 'none', width: '100%' }} onClick={auth.signOut}>
          <Icon.Lock />Sign out
        </button>
        <p className="sidebar-legal">Trading carries risk. Bots do not guarantee profit.</p>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          <span style={{ flex: 1 }} />
          {auth.status === 'ready' && auth.accounts.length > 0 && (
            <>
              <select className="input" style={{ width: 'auto', padding: '8px 12px' }} aria-label="Trading account"
                value={auth.account?.id ?? ''} onChange={(e) => auth.setAccountId(e.target.value)}>
                {auth.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <div className="balance-chip">
                <span className={`dot ${auth.account?.isVirtual ? 'dot-demo' : 'dot-real'}`} />
                <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>{auth.account?.isVirtual ? 'DEMO' : 'REAL'}</span>
                <b className="mono">{auth.balance}</b>
              </div>
            </>
          )}
        </header>
        <main className="shell-content">
          {auth.status === 'error' ? <p className="error" role="alert">{auth.error}</p> : <Outlet />}
        </main>
      </div>
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
    </div>
  );
}
