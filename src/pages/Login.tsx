import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { getSession, startLogin } from '../lib/derivAuth';

/** `/` — sign in with Deriv (OAuth 2.0 + PKCE, trade scope only). Logged-in users go straight to the dashboard. */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = state.from && state.from.startsWith('/') && !state.from.startsWith('//') ? state.from : '/app';
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState(state.error ?? '');

  useEffect(() => {
    getSession()
      .then((s) => (s.loggedIn ? navigate(returnTo, { replace: true }) : setChecking(false)))
      .catch(() => setChecking(false));
  }, [navigate, returnTo]);

  const go = (signup: boolean) => {
    setBusy(signup ? 'signup' : 'login');
    setError('');
    startLogin({ signup, returnTo }).catch((e: Error) => { setError(e.message); setBusy(null); });
  };

  return (
    <div className="login-bg">
      <main className="login-card" aria-busy={checking}>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <span className="brand-mark" style={{ width: 40, height: 40 }}><Icon.Logo /></span>
          <div className="stack">
            <b style={{ fontSize: 20 }}>Mwasya</b>
            <span className="hint" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.06em' }}>OPERATOR STUDIO</span>
          </div>
        </div>

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

        <p className="hint" style={{ textAlign: 'center' }}>
          New to Mwasya? <Link to="/about">See what it does</Link>
        </p>
      </main>
      <p className="login-legal">Mwasya is independent and not affiliated with Deriv. Trading derivatives carries a high level of risk.</p>
    </div>
  );
}
