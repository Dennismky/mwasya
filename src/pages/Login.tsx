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
          <div className="stack" style={{ gap: 6 }}>
            <span className="auth-kicker">OPERATOR STUDIO</span>
            <h2>{t('login.signIn')}</h2>
            <p className="muted">{t('login.sub')}</p>
          </div>

          {inviter && (
            <div className="auth-invite"><Icon.Users /><span>You've been invited by <b>{inviter}</b>. Log in to create your own site.</span></div>
          )}

          {checking ? (
            <p className="muted" aria-live="polite"><span className="spinner" /> Checking your session…</p>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <button className="btn btn-primary auth-btn" disabled={busy !== null} onClick={() => go(false)}>
                {busy === 'login' ? 'Opening Deriv…' : t('login.button')} <Icon.Arrow />
              </button>
              <div className="auth-or"><span>New to Deriv?</span></div>
              <button className="btn btn-secondary auth-btn" disabled={busy !== null} onClick={() => go(true)}>
                {busy === 'signup' ? 'Opening Deriv…' : t('login.create')}
              </button>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          )}

          <ul className="auth-trust">
            <li><Icon.Shield /> Trade access only — we can never withdraw.</li>
            <li><Icon.Key /> We never see your password or API tokens.</li>
            <li><Icon.Lock /> Encrypted session, kept on our server.</li>
          </ul>
        </div>
        <p className="auth-legal">
          <Link to="/about">About Mwasya</Link> · Built on the Deriv API · Trading carries risk.
        </p>
      </main>
    </div>
  );
}
