import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui';
import { KEY_INVITE, getSession, safeReturnPath, startLogin } from '../lib/derivAuth';

const KEY_EMAIL = 'mw_login_email';
export const KEY_PENDING_PROFILE = 'mw_pending_profile';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Animated forex symbols floating behind the card. */
const FLOAT: { t: string; x: number; y: number; s: number; d: number; k?: 'pip' | 'pair' | 'up' | 'down' | 'candle' }[] = [
  { t: '$', x: 6, y: 14, s: 64, d: 0 }, { t: '€', x: 88, y: 10, s: 54, d: 2.5 }, { t: '£', x: 80, y: 78, s: 58, d: 1.2 },
  { t: '¥', x: 12, y: 80, s: 48, d: 3.4 }, { t: '$', x: 46, y: 90, s: 40, d: 4.1 }, { t: '₿', x: 94, y: 46, s: 42, d: 5 },
  { t: '+12.4 pips', x: 18, y: 42, s: 15, d: 1.8, k: 'pip' }, { t: '−3.1 pips', x: 72, y: 28, s: 14, d: 3.9, k: 'pip' },
  { t: 'EUR/USD', x: 30, y: 8, s: 14, d: 0.6, k: 'pair' }, { t: 'GBP/JPY', x: 62, y: 92, s: 14, d: 2.9, k: 'pair' },
  { t: 'XAU/USD', x: 4, y: 60, s: 14, d: 4.6, k: 'pair' },
  { t: '▲', x: 56, y: 6, s: 22, d: 1.1, k: 'up' }, { t: '▼', x: 36, y: 72, s: 20, d: 3.1, k: 'down' },
  { t: '', x: 90, y: 64, s: 46, d: 2.2, k: 'candle' }, { t: '', x: 24, y: 24, s: 40, d: 4.4, k: 'candle' },
];

function Candles() {
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true">
      <path d="M8 6v28M20 2v34M32 10v22" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="12" width="6" height="14" rx="1" fill="#12A07A" /><rect x="17" y="8" width="6" height="18" rx="1" fill="#E5484D" /><rect x="29" y="14" width="6" height="12" rx="1" fill="#12A07A" />
    </svg>
  );
}

/** `/` on mwasya.site — mentor sign-in. The Deriv password is only ever typed on Deriv's own page (OAuth 2.0 + PKCE). */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(state.error ?? '');
  const [inviter, setInviter] = useState<string | null>(null);
  const [view, setView] = useState<'login' | 'signup' | 'forgot'>('login');
  const [email, setEmail] = useState(() => localStorage.getItem(KEY_EMAIL) ?? '');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(KEY_EMAIL));
  const [name, setName] = useState('');

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
      setView('signup');
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const signup = view === 'signup';
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setError('Enter a valid email address.');
    if (signup) {
      if (name.trim().length < 2) return setError('Enter your full name.');
      if (!mail) return setError('Enter your email address.');
      localStorage.setItem(KEY_PENDING_PROFILE, JSON.stringify({ name: name.trim().slice(0, 60), email: mail.slice(0, 120) }));
    }
    if (remember && mail) localStorage.setItem(KEY_EMAIL, mail); else localStorage.removeItem(KEY_EMAIL);
    setBusy(true);
    startLogin({ signup, returnTo }).catch((err: Error) => { setError(err.message); setBusy(false); });
  };

  const switchTo = (v: typeof view) => { setView(v); setError(''); };

  return (
    <div className="lg">
      <div className="lg-bg" aria-hidden="true">
        {FLOAT.map((f, i) => (
          <span key={i} className={`lg-f ${f.k ? `lg-${f.k}` : 'lg-cur'}`}
            style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: f.s, width: f.k === 'candle' ? f.s : undefined, height: f.k === 'candle' ? f.s : undefined, animationDelay: `-${f.d}s` } as CSSProperties}>
            {f.k === 'candle' ? <Candles /> : f.t}
          </span>
        ))}
        <svg className="lg-line" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 220 L80 200 L140 230 L220 160 L300 180 L380 120 L460 150 L540 90 L620 130 L700 70 L780 110 L860 60 L940 100 L1020 40 L1100 80 L1200 30" /></svg>
      </div>

      <div className="lg-card">
        <aside className="lg-hero">
          <i className="lg-bub b1" /><i className="lg-bub b2" /><i className="lg-bub b3" /><i className="lg-bub b4" />
          <div className="lg-hero-in">
            <div className="lg-logo"><span className="brand-mark"><Icon.Logo /></span><b>Mwasya</b></div>
            <h1>WELCOME</h1>
            <h2>YOUR TRADING BRAND STUDIO</h2>
            <p>Build branded Deriv trading sites, give clients ready-made bots, grow your mentor network and earn markup on every trade.</p>
            <div className="lg-ticks">
              <span><b>EUR/USD</b> 1.0842 <em className="up">▲ 0.12%</em></span>
              <span><b>Vol 100</b> 1,284.37 <em className="down">▼ 0.08%</em></span>
            </div>
          </div>
        </aside>

        <main className="lg-form" aria-busy={checking}>
          <div className="lg-head" key={view}>
            <h3>{view === 'login' ? 'Sign in' : view === 'signup' ? 'Sign up' : 'Reset password'}</h3>
            <p>{view === 'login' ? 'Welcome back. Sign in to your mentor studio.' : view === 'signup' ? 'Create your mentor account in a minute.' : 'Reset your password on Deriv in four steps.'}</p>
          </div>

          {inviter && view !== 'forgot' && <div className="auth-invite"><Icon.Users /><span>Invited by <b>{inviter}</b></span></div>}

          {checking ? (
            <p className="muted" aria-live="polite"><span className="spinner" /> Checking your session…</p>
          ) : view === 'forgot' ? (
            <div className="lg-body" key="forgot">
              <ol className="auth-steps">
                <li><span>1</span>Continue to the Deriv sign-in page.</li>
                <li><span>2</span>Select <b>Forgot password?</b> and enter your email.</li>
                <li><span>3</span>Open the link Deriv emails you and set a new password.</li>
                <li><span>4</span>Sign in here with the new password.</li>
              </ol>
              <button className="lg-btn" disabled={busy} onClick={() => { setBusy(true); startLogin({ returnTo }).catch((e: Error) => { setError(e.message); setBusy(false); }); }}>
                {busy ? 'Opening Deriv…' : 'Continue to Deriv'}
              </button>
              {error && <p className="error" role="alert">{error}</p>}
              <p className="lg-foot"><button type="button" className="auth-link" onClick={() => switchTo('login')}>← Back to sign in</button></p>
            </div>
          ) : (
            <form className="lg-body" key={view} onSubmit={submit} noValidate>
              {view === 'signup' && (
                <label className="lg-in">
                  <Icon.Users />
                  <input type="text" autoComplete="name" placeholder="e.g. Emily Carter" value={name} onChange={(e) => setName(e.target.value)} aria-label="Full name" maxLength={60} />
                </label>
              )}
              <label className="lg-in">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
                <input type="email" autoComplete="email" inputMode="email" placeholder={view === 'signup' ? 'e.g. emily.carter@gmail.com' : 'e.g. james.walker@gmail.com'} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" maxLength={120} />
              </label>
              <div className="lg-in lg-secure" title="Your Deriv password is typed only on Deriv's secure page.">
                <Icon.Lock />
                <span>Password is entered on Deriv's secure page</span>
                <em>SECURE</em>
              </div>

              {view === 'login' && (
                <div className="lg-row">
                  <label className="lg-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me</label>
                  <button type="button" className="auth-link" onClick={() => switchTo('forgot')}>Forgot password?</button>
                </div>
              )}

              <button className="lg-btn" type="submit" disabled={busy}>
                {busy ? 'Opening Deriv…' : view === 'login' ? 'Sign in' : 'Create account'}
              </button>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="auth-or"><span>or</span></div>
              <button type="button" className="lg-btn lg-ghost" disabled={busy} onClick={() => switchTo(view === 'login' ? 'signup' : 'login')}>
                {view === 'login' ? 'Create a new account' : 'Sign in to my account'}
              </button>
              <p className="lg-foot">
                {view === 'login'
                  ? <>Don't have an account? <button type="button" className="auth-link" onClick={() => switchTo('signup')}>Sign up</button></>
                  : <>Already have an account? <button type="button" className="auth-link" onClick={() => switchTo('login')}>Sign in</button></>}
              </p>
            </form>
          )}
          <i className="lg-bub b5" aria-hidden="true" />
        </main>
      </div>

      <p className="lg-legal"><Link to="/about">About Mwasya</Link> · Built on the Deriv API · Trading carries risk.</p>
    </div>
  );
}
