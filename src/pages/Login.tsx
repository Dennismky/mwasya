import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';
import { Icon } from '../components/ui';
import { KEY_INVITE, getSession, safeReturnPath, startLogin } from '../lib/derivAuth';

export const KEY_PENDING_PROFILE = 'mw_pending_profile';

/** `/` on mwasya.site — mentor sign-in. The Deriv password is only ever typed on Deriv's own page (OAuth 2.0 + PKCE). */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const [inviter, setInviter] = useState<string | null>(null);
  const [invited] = useState(() => /[?&]invite=/.test(location.search));

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

  return (
    <AuthCard
      brand={{
        name: 'Mwasya',
        kicker: 'YOUR TRADING BRAND STUDIO',
        blurb: 'Build branded Deriv trading sites, give clients ready-made bots, grow your mentor network and earn markup on every trade.',
        chips: <>
          <span><b>EUR/USD</b> 1.0842 <em className="up">▲ 0.12%</em></span>
          <span><b>Vol 100</b> 1,284.37 <em className="down">▼ 0.08%</em></span>
        </>,
      }}
      checking={checking}
      askName
      initialView={invited ? 'signup' : 'login'}
      error={state.error}
      notice={inviter ? <div className="auth-invite"><Icon.Users /><span>Invited by <b>{inviter}</b></span></div> : undefined}
      onStart={async (signup, { name, email }) => {
        if (signup) localStorage.setItem(KEY_PENDING_PROFILE, JSON.stringify({ name: name.slice(0, 60), email: email.slice(0, 120) }));
        await startLogin({ signup, returnTo, fresh: !signup, email: email || undefined });
      }}
      legal={<><Link to="/about">About Mwasya</Link> · Built on the Deriv API · Trading carries risk.</>}
    />
  );
}
