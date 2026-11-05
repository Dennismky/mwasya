import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { completeLogin } from '../lib/derivAuth';
import { Brand } from '../components/ui';
import { KEY_PENDING_PROFILE } from './Login';
import { toast } from '../components/motion';

export default function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-run guard: the code is single-use.
    ran.current = true;
    completeLogin(window.location.search).then((r) => {
      if (r.ok) { void savePendingProfile(); if (r.notice) toast(r.notice, 'info'); navigate(r.returnTo, { replace: true }); }
      else setError(r.error);
    });
  }, [navigate]);

  return (
    <main className="container stack" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', gap: 20, textAlign: 'center' }}>
      <Brand />
      {error ? (
        <>
          <h1 style={{ fontSize: 24 }}>We couldn't sign you in</h1>
          <p className="muted" role="alert">{error}</p>
          <Link className="btn btn-primary" to="/">Try again</Link>
        </>
      ) : (
        <p className="muted" aria-live="polite">Finishing sign-in with Deriv…</p>
      )}
    </main>
  );
}

/** Sign-up form details (name, email) are saved to the mentor's profile once, after the first Deriv login. */
async function savePendingProfile() {
  const raw = localStorage.getItem(KEY_PENDING_PROFILE);
  if (!raw) return;
  localStorage.removeItem(KEY_PENDING_PROFILE);
  try {
    const p = JSON.parse(raw) as { name?: string; email?: string };
    const cur = await fetch('/api/settings/profile', { credentials: 'same-origin' });
    if (!cur.ok) return;
    const { profile } = await cur.json() as { profile: { display_name: string | null; contact: string | null; language: string } };
    if (profile.display_name && profile.contact) return;
    await fetch('/api/settings/profile', {
      method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: profile.display_name || p.name || '', contact: profile.contact || p.email || '', language: profile.language }),
    });
  } catch { /* profile can still be set in Settings */ }
}
