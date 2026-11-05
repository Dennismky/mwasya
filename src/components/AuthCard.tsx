import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from './ui';

const KEY_EMAIL = 'mw_login_email';
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

export interface AuthBrand {
  name: string;
  logoUrl?: string | null;
  /** Main colour. Mwasya royal blue by default; a client site passes its own and it blends with Mwasya navy. */
  accent?: string;
  kicker: string;
  blurb: string;
  chips?: ReactNode;
}

/**
 * Split login card used by mwasya.site and by every client trading site.
 * The Deriv password is only ever typed on Deriv's own page (OAuth 2.0 + PKCE); this card never asks for it.
 */
export function AuthCard({ brand, checking, askName, initialView = 'login', notice, error: outerError, onStart, legal }: {
  brand: AuthBrand;
  checking: boolean;
  askName?: boolean;
  initialView?: 'login' | 'signup';
  notice?: ReactNode;
  error?: string;
  onStart: (signup: boolean, data: { name: string; email: string }) => Promise<void>;
  legal?: ReactNode;
}) {
  const [view, setView] = useState<'login' | 'signup' | 'forgot'>(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(() => localStorage.getItem(KEY_EMAIL) ?? '');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(KEY_EMAIL));
  const [name, setName] = useState('');
  const shownError = error || outerError;

  const start = (signup: boolean) => {
    setBusy(true);
    onStart(signup, { name: name.trim(), email: email.trim() }).catch((e: Error) => { setError(e.message); setBusy(false); });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const signup = view === 'signup';
    const mail = email.trim();
    if (mail && !EMAIL_RE.test(mail)) return setError('Enter a valid email address.');
    if (signup && askName && name.trim().length < 2) return setError('Enter your full name.');
    if (signup && askName && !mail) return setError('Enter your email address.');
    if (remember && mail) localStorage.setItem(KEY_EMAIL, mail); else if (!signup) localStorage.removeItem(KEY_EMAIL);
    start(signup);
  };
  const switchTo = (v: typeof view) => { setView(v); setError(''); };
  const initials = brand.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'M';

  return (
    <div className="lg" style={{ '--lg-a': brand.accent ?? '#1F4FD1' } as CSSProperties}>
      <div className="lg-bg" aria-hidden="true">
        {FLOAT.map((f, i) => (
          <span key={i} className={`lg-f ${f.k ? `lg-${f.k}` : 'lg-cur'}`}
            style={{ left: `${f.x}%`, top: `${f.y}%`, fontSize: f.s, width: f.k === 'candle' ? f.s : undefined, height: f.k === 'candle' ? f.s : undefined, animationDelay: `-${f.d}s` }}>
            {f.k === 'candle' ? <Candles /> : f.t}
          </span>
        ))}
        <svg className="lg-line" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 220 L80 200 L140 230 L220 160 L300 180 L380 120 L460 150 L540 90 L620 130 L700 70 L780 110 L860 60 L940 100 L1020 40 L1100 80 L1200 30" /></svg>
      </div>

      <div className="lg-card">
        <aside className="lg-hero">
          <i className="lg-bub b1" /><i className="lg-bub b2" /><i className="lg-bub b3" /><i className="lg-bub b4" />
          <div className="lg-hero-in">
            <div className="lg-logo">
              {brand.logoUrl ? <img className="brand-mark" src={brand.logoUrl} alt="" style={{ objectFit: 'cover' }} /> : <span className="brand-mark">{brand.accent ? initials : <Icon.Logo />}</span>}
              <b>{brand.name}</b>
            </div>
            <h1>WELCOME</h1>
            <h2>{brand.kicker}</h2>
            <p>{brand.blurb}</p>
            {brand.chips && <div className="lg-ticks">{brand.chips}</div>}
          </div>
        </aside>

        <main className="lg-form" aria-busy={checking}>
          <div className="lg-head" key={view}>
            <h3>{view === 'login' ? 'Sign in' : view === 'signup' ? 'Sign up' : 'Reset password'}</h3>
            <p>{view === 'login' ? `Welcome back to ${brand.name}.` : view === 'signup' ? `Create your account on ${brand.name}.` : 'Reset your password on Deriv in four steps.'}</p>
          </div>

          {notice && view !== 'forgot' && notice}

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
              <button className="lg-btn" disabled={busy} onClick={() => start(false)}>{busy ? 'Opening Deriv…' : 'Continue to Deriv'}</button>
              {shownError && <p className="error" role="alert">{shownError}</p>}
              <p className="lg-foot"><button type="button" className="auth-link" onClick={() => switchTo('login')}>← Back to sign in</button></p>
            </div>
          ) : (
            <form className="lg-body" key={view} onSubmit={submit} noValidate>
              {view === 'signup' && askName && (
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

              <button className="lg-btn" type="submit" disabled={busy}>{busy ? 'Opening Deriv…' : view === 'login' ? 'Sign in' : 'Create account'}</button>
              {shownError && <p className="error" role="alert">{shownError}</p>}
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

      {legal && <p className="lg-legal">{legal}</p>}
    </div>
  );
}
