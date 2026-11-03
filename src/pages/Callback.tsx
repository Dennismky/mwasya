import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { completeLogin } from '../lib/derivAuth';
import { Brand } from '../components/ui';

export default function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // StrictMode double-run guard: the code is single-use.
    ran.current = true;
    completeLogin(window.location.search).then((r) => {
      if (r.ok) navigate(r.returnTo, { replace: true });
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
          <Link className="btn btn-primary" to="/app">Try again</Link>
        </>
      ) : (
        <p className="muted" aria-live="polite">Finishing sign-in with Deriv…</p>
      )}
    </main>
  );
}
