import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { KEY_INVITE, getSession, safeReturnPath, startLogin } from '../lib/derivAuth';
import type { SiteBranding } from '../lib/tenant';

/** `/` — sign in with Deriv (OAuth 2.0 + PKCE, trade scope only). Logged-in users go straight to the dashboard. */
export default function Login({ site }: { site?: SiteBranding }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState(state.error ?? '');

  const [inviter, setInviter] = useState<string | null>(null);

  useEffect(() => {
    getSession()
      .then((s) => (s.loggedIn ? navigate(returnTo, { replace: true }) : setChecking(false)))
      .catch(() => setChecking(false));
  }, [navigate, returnTo]);

  // Invite links (studio only): mwasya.site/?invite=CODE → remember it for the login, show who invited you.
  useEffect(() => {
    if (site) return;
    const fromUrl = new URLSearchParams(location.search).get('invite');
    if (fromUrl && /^[A-Za-z0-9_-]{10,40}$/.test(fromUrl)) {
      localStorage.setItem(KEY_INVITE, fromUrl);
      window.history.replaceState(null, '', '/');
    }
    const code = localStorage.getItem(KEY_INVITE);
    if (!code) return;
    fetch(`/api/invites/info?code=${encodeURIComponent(code)}`)
      .then((r) => (r.ok ? r.json() : { valid: false }))
      .then((j: { valid: boolean; inviter?: string }) => {
        if (j.valid) setInviter(j.inviter ?? 'a Mwasya operator');
        else localStorage.removeItem(KEY_INVITE);
      })
      .catch(() => undefined);
  }, [site, location.search]);

  const go = (signup: boolean) => {
    setBusy(signup ? 'signup' : 'login');
    setError('');
    startLogin({ signup, returnTo }).catch((e: Error) => { setError(e.message); setBusy(null); });
  };

  return (
    <div className="login-bg" style={site ? ({ background: `radial-gradient(1000px 520px at 10% -10%, ${site.accent} 0%, transparent 60%), #0B1F3A`, "--primary": site.accent, "--primary-hover": site.accent } as CSSProperties) : undefined}>
      <main className="login-card" aria-busy={checking}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <span className="brand-mark" style={{ width: 40, height: 40, background: site?.accent }}>{site ? site.name.charAt(0).toUpperCase() : <Icon.Logo />}</span>
          <div className="stack">
            <b style={{ fontSize: 20 }}>{site?.name ?? "Mwasya"}</b>
            <span className="hint" style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em" }}>{site ? "TRADING BOTS" : "OPERATOR STUDIO"}</span>
          </div>
        </div>

        {inviter && (
          <div className="notice" style={{ padding: '12px 14px' }}>
            <span>You've been invited by <b>{inviter}</b>. Log in to create your own site.</span>
          </div>
        )}

        <div className="stack" style={{ gap: 8 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Sign in</h1>
          <p className="muted">Use your Deriv account. You sign in on Deriv's own page and come straight back here.</p>
        </div>

        {checking ? (
          <p className="muted" aria-live="polite"><span className="spinner" /> Checking session…</p>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            <button className="btn btn-primary btn-lg" disabled={busy !== null} onClick={() => go(false)}>
              {busy === 'login' ? 'Opening Deriv…' : 'Log in with Deriv'} <Icon.Arrow />
            </button>
            <button className="btn btn-secondary btn-lg" disabled={busy !== null} onClick={() => go(true)}>
              {busy === 'signup' ? 'Opening Deriv…' : 'Create a Deriv account'}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        )}

        <ul className="login-points">
          <li><Icon.Shield /> Trade access only. We can never withdraw your funds.</li>
          <li><Icon.Key /> We never see your password or ask for API tokens.</li>
          <li><Icon.Lock /> Your session is encrypted and stays on our server.</li>
        </ul>

        {!site && <p className="hint" style={{ textAlign: "center" }}>
          New to Mwasya? <Link to="/about">See what it does</Link>
        </p>}
      </main>
      <p className="login-legal">Built on the Deriv API. Trading carries risk. Only trade with money you can afford to lose.</p>
    </div>
  );
}
