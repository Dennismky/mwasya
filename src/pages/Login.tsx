import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { KEY_INVITE, getSession, safeReturnPath, startLogin } from '../lib/derivAuth';
import { useT } from '../lib/i18n';

/** `/` on mwasya.site — mentor sign-in with Deriv (OAuth 2.0 + PKCE). Logged-in users go straight to the studio. */
export default function Login() {
  const navigate = useNavigate();
  const t = useT();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState<'login' | 'signup' | null>(null);
  const [error, setError] = useState(state.error ?? '');
  const [inviter, setInviter] = useState<string | null>(null);
  const [view, setView] = useState<'login' | 'signup' | 'forgot'>('login');

  useEffect(() => {
    getSession()
      .then((s) => (s.loggedIn ? navigate(returnTo, { replace: true }) : setChecking(false)))
      .catch(() => setChecking(false));
  }, [navigate, returnTo]);

  // Invite links: mwasya.site/?invite=CODE → remember it for the login and show who invited you.
  useEffect(() => {
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
        if (j.valid) setInviter(j.inviter ?? 'a Mwasya mentor');
        else localStorage.removeItem(KEY_INVITE);
      })
      .catch(() => undefined);
  }, [location.search]);

  const go = (signup: boolean) => {
    setBusy(signup ? 'signup' : 'login');
    setError('');
    startLogin({ signup, returnTo }).catch((e: Error) => { setError(e.message); setBusy(null); });
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-logo"><span className="brand-mark"><Icon.Logo /></span><b>Mwasya</b></div>
        <div className="auth-pitch">
          <h1>Launch your own Deriv trading brand.</h1>
          <p>Build branded trading sites, give your clients ready-made bots, grow a network of mentors, and earn markup on every trade.</p>
          <ul>
            <li><span><Icon.Globe /></span><div><b>Your sites, your domain</b><small>Design, deploy and connect a domain in minutes.</small></div></li>
            <li><span><Icon.Chip /></span><div><b>Bots your clients can run</b><small>Safety limits on every bot, run by Deriv.</small></div></li>
            <li><span><Icon.Coin /></span><div><b>Markup paid by Deriv</b><small>Straight to your own Deriv account.</small></div></li>
          </ul>
        </div>
        <div className="auth-facts">
          <div><b>Deriv API</b><small>Official login</small></div>
          <div><b>Trade only</b><small>Never withdrawals</small></div>
          <div><b>M-Pesa</b><small>Local payments</small></div>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card" aria-busy={checking}>
          {view !== 'forgot' && (
            <div className="auth-tabs" role="tablist" aria-label="Account">
              <button role="tab" aria-selected={view === 'login'} className={view === 'login' ? 'on' : ''} onClick={() => setView('login')}>Log in</button>
              <button role="tab" aria-selected={view === 'signup'} className={view === 'signup' ? 'on' : ''} onClick={() => setView('signup')}>Sign up</button>
              <span className="auth-tabs-ink" style={{ transform: `translateX(${view === 'signup' ? 100 : 0}%)` }} />
            </div>
          )}

          <div className="stack auth-head" key={view} style={{ gap: 6 }}>
            <span className="auth-kicker">MENTOR STUDIO</span>
            <h2>{view === 'login' ? 'Welcome back' : view === 'signup' ? 'Create your account' : 'Reset your password'}</h2>
          </div>

          {inviter && view !== 'forgot' && (
            <div className="auth-invite"><Icon.Users /><span>Invited by <b>{inviter}</b></span></div>
          )}

          {checking ? (
            <p className="muted" aria-live="polite"><span className="spinner" /> Checking your session…</p>
          ) : view === 'forgot' ? (
            <div className="stack auth-body" style={{ gap: 14 }}>
              <ol className="auth-steps">
                <li><span>1</span>Continue to the Deriv sign-in page.</li>
                <li><span>2</span>Select <b>Forgot password?</b> and enter your email.</li>
                <li><span>3</span>Open the link Deriv emails you and set a new password.</li>
                <li><span>4</span>Log in here with the new password.</li>
              </ol>
              <button className="btn btn-primary auth-btn" disabled={busy !== null} onClick={() => go(false)}>
                {busy === 'login' ? 'Opening Deriv…' : 'Continue to Deriv'} <Icon.Arrow />
              </button>
              <button className="auth-link" onClick={() => setView('login')}>← Back to log in</button>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          ) : (
            <div className="stack auth-body" style={{ gap: 12 }}>
              {view === 'login' ? (
                <>
                  <button className="btn btn-primary auth-btn" disabled={busy !== null} onClick={() => go(false)}>
                    {busy === 'login' ? 'Opening Deriv…' : t('login.button')} <Icon.Arrow />
                  </button>
                  <div className="auth-row">
                    <button className="auth-link" onClick={() => setView('forgot')}>Forgot password?</button>
                    <button className="auth-link" onClick={() => setView('signup')}>Create account</button>
                  </div>
                </>
              ) : (
                <>
                  <button className="btn btn-primary auth-btn" disabled={busy !== null} onClick={() => go(true)}>
                    {busy === 'signup' ? 'Opening Deriv…' : t('login.create')} <Icon.Arrow />
                  </button>
                  <div className="auth-row">
                    <span className="muted">Already have an account?</span>
                    <button className="auth-link" onClick={() => setView('login')}>Log in</button>
                  </div>
                </>
              )}
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          )}
        </div>
        <p className="auth-legal">
          <Link to="/about">About Mwasya</Link> · Built on the Deriv API · Trading carries risk.
        </p>
      </main>
    </div>
  );
}
