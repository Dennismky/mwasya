import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Icon } from '../components/ui';
import { getSession, logout, startLogin } from '../lib/derivAuth';
import { accountSocket, publicSocket, type DerivSocket } from '../lib/derivWs';
import { useSiteConfig } from '../store/siteConfig';
import { parseAccounts, type Account } from '../lib/accounts';


type Status = 'checking' | 'signed-out' | 'loading' | 'ready' | 'error';

export default function Dashboard() {
  const site = useSiteConfig();
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [balance, setBalance] = useState<string>('—');
  const [tick, setTick] = useState<{ quote: number; dir: 'up' | 'down' | 'flat' } | null>(null);
  const privateWs = useRef<DerivSocket | null>(null);

  const expired = useCallback(() => {
    setStatus('signed-out');
    setError('Your Deriv session has ended. Please log in again.');
  }, []);

  // 1. Session + accounts
  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (!s.loggedIn) return setStatus('signed-out');
      setStatus('loading');
      const r = await fetch('/api/deriv/accounts', { credentials: 'same-origin' });
      if (r.status === 401) return expired();
      if (!r.ok) { setError('Could not load your Deriv accounts.'); return setStatus('error'); }
      const list = parseAccounts(await r.json());
      setAccounts(list);
      setAccountId((list.find((a) => a.isVirtual) ?? list[0])?.id ?? '');
      setStatus('ready');
    })().catch(() => { setError('Something went wrong.'); setStatus('error'); });
  }, [expired]);

  // 2. Private socket for the selected account → live balance
  useEffect(() => {
    if (!accountId) return;
    const ws = accountSocket(accountId);
    privateWs.current = ws;
    let stop: (() => void) | undefined;
    ws.subscribe({ balance: 1 }, (msg) => {
      const b = msg.balance as { balance?: number; currency?: string } | undefined;
      if (b?.balance !== undefined) setBalance(`${b.balance.toFixed(2)} ${b.currency ?? ''}`.trim());
    })
      .then((u) => { stop = u; })
      .catch((e: Error) => (e.message === 'SESSION_EXPIRED' ? expired() : setError(e.message)));
    return () => { stop?.(); ws.close(); };
  }, [accountId, expired]);

  // 3. Public ticks (no login needed)
  useEffect(() => {
    const ws = publicSocket();
    let last = 0;
    let stop: (() => void) | undefined;
    ws.subscribe({ ticks: 'R_100' }, (msg) => {
      const q = (msg.tick as { quote?: number } | undefined)?.quote;
      if (typeof q !== 'number') return;
      setTick({ quote: q, dir: q > last ? 'up' : q < last ? 'down' : 'flat' });
      last = q;
    }).then((u) => { stop = u; }).catch(() => undefined);
    return () => { stop?.(); ws.close(); };
  }, []);

  const signOut = async () => { await logout(); setStatus('signed-out'); setAccounts([]); setAccountId(''); };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-alt)' }}>
      <header className="nav">
        <div className="container nav-inner">
          <Brand />
          <span style={{ flex: 1 }} />
          {status === 'ready' && (
            <>
              <div className="stack" style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>BALANCE</span>
                <b className="mono" style={{ fontSize: 15 }}>{balance}</b>
              </div>
              <Link className="btn btn-secondary" to="/forge">Bot Forge</Link>
              <button className="btn btn-secondary" onClick={signOut}>Log out</button>
            </>
          )}
        </div>
      </header>

      <main className="container stack" style={{ padding: '40px 24px', gap: 24 }}>
        {(status === 'checking' || status === 'loading') && <p className="muted" aria-live="polite">Loading…</p>}

        {status === 'signed-out' && (
          <section className="card stack" style={{ maxWidth: 520, gap: 18 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700 }}>Log in to {site.name}</h1>
            <p className="muted">You sign in on Deriv's own page. We never see your password and never ask for an API token. This site can read your account and place trades, but it can never withdraw.</p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row" style={{ gap: 12 }}>
              <button className="btn btn-primary btn-lg" onClick={() => startLogin().catch((e: Error) => setError(e.message))}>Log in with Deriv</button>
              <button className="btn btn-secondary btn-lg" onClick={() => startLogin({ signup: true }).catch((e: Error) => setError(e.message))}>Create account</button>
            </div>
          </section>
        )}

        {status === 'error' && <p className="error" role="alert">{error}</p>}

        {status === 'ready' && (
          <div className="grid">
            <section className="card stack" style={{ gap: 14 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Account</h2>
              <div className="field">
                <label className="label" htmlFor="acct">Trading account</label>
                <select id="acct" className="input" value={accountId} onChange={(e) => { setBalance('—'); setAccountId(e.target.value); }}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              {error && <p className="error" role="alert">{error}</p>}
              <span className="badge badge-green" style={{ alignSelf: 'flex-start' }}><Icon.Shield /> Trade access only</span>
            </section>
            <section className="card stack" style={{ gap: 10 }} aria-live="polite">
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Volatility 100 Index</h2>
              <b className="mono" style={{ fontSize: 34, color: tick?.dir === 'down' ? 'var(--danger)' : tick?.dir === 'up' ? 'var(--success)' : 'var(--text)' }}>
                {tick ? `${tick.dir === 'up' ? '▲' : tick.dir === 'down' ? '▼' : ''} ${tick.quote}` : '—'}
              </b>
              <span className="hint">Live public price feed</span>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
