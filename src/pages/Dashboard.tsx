import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import { startLogin } from '../lib/derivAuth';
import { publicSocket } from '../lib/derivWs';
import { useSiteConfig } from '../store/siteConfig';

/** `/app` — operator overview. Auth + accounts come from <AppShell />. */
export default function Dashboard() {
  const auth = useAuth();
  const site = useSiteConfig();
  const [botCount, setBotCount] = useState<number | null>(null);
  const [tick, setTick] = useState<{ quote: number; dir: 'up' | 'down' | 'flat' } | null>(null);

  useEffect(() => {
    if (!auth.operator) return;
    fetch('/api/bots', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { bots: [] }))
      .then((j: { bots: unknown[] }) => setBotCount(j.bots.length))
      .catch(() => setBotCount(0));
  }, [auth.operator]);

  useEffect(() => {
    const ws = publicSocket();
    let last = 0;
    let stop: (() => void) | undefined;
    ws.subscribe({ ticks: '1HZ100V' }, (msg) => {
      const q = (msg.tick as { quote?: number } | undefined)?.quote;
      if (typeof q !== 'number') return;
      setTick({ quote: q, dir: q > last ? 'up' : q < last ? 'down' : 'flat' });
      last = q;
    }).then((u) => { stop = u; }).catch(() => undefined);
    return () => { stop?.(); ws.close(); };
  }, []);

  const steps = [
    { done: auth.accounts.length > 0, title: 'Connect your Deriv account', text: 'Bots and sites run on the Deriv API.',
      detail: auth.account && <span className="badge badge-green"><Icon.Check /> Connected · {auth.account.id}</span> },
    { done: (botCount ?? 0) > 0, title: 'Forge your first bot', text: 'Pick a template, set limits, test it on demo.', to: '/forge', cta: 'Open Bot Forge' },
    { done: Boolean(site.derivAppId), title: 'Set up your site', text: 'Brand, Deriv app ID and markup, then publish.', to: '/setup', cta: 'Set up site' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Overview</h1>
        <p className="muted">Build bots, run your site and track your traders.</p>
      </div>

      {!auth.operator && (
        <div className="notice">
          <div className="stack" style={{ gap: 4 }}>
            <b>Finish linking your workspace</b>
            <span className="hint">Log in once more so we can save your bots to your Mwasya workspace.</span>
          </div>
          <button className="btn btn-primary" onClick={() => startLogin({ returnTo: '/app' })}>Log in again</button>
        </div>
      )}

      <section className="card stack" style={{ gap: 18, maxWidth: 760 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Let's get you live</h2>
          <p className="muted">Finish these steps and your first bot is in front of traders.</p>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
            <span>{doneCount} of {steps.length} complete</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.title} className={`step ${s.done ? 'step-done' : ''}`}>
              <span className="step-num" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
              <div className="stack" style={{ gap: 4, flex: 1 }}>
                <b>{s.title}</b>
                <span className="hint">{s.text}</span>
                {s.detail}
              </div>
              {!s.done && s.to && <Link className="btn btn-secondary" to={s.to}>{s.cta} <Icon.Arrow /></Link>}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid">
        <section className="card stack" style={{ gap: 8 }}>
          <span className="hint" style={{ fontWeight: 600 }}>BALANCE · {auth.account?.isVirtual ? 'DEMO' : 'REAL'}</span>
          <b className="mono" style={{ fontSize: 30 }}>{auth.balance}</b>
          <span className="hint">{auth.account?.id}</span>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <span className="hint" style={{ fontWeight: 600 }}>MY BOTS</span>
          <b className="mono" style={{ fontSize: 30 }}>{botCount ?? '—'}</b>
          <Link to="/forge" className="hint">Manage in Bot Forge →</Link>
        </section>
        <section className="card stack" style={{ gap: 8 }} aria-live="polite">
          <span className="hint" style={{ fontWeight: 600 }}>VOLATILITY 100 (1s)</span>
          <b className="mono" style={{ fontSize: 30, color: tick?.dir === 'down' ? 'var(--danger)' : tick?.dir === 'up' ? 'var(--success)' : 'var(--text)' }}>
            {tick ? `${tick.dir === 'up' ? '▲' : tick.dir === 'down' ? '▼' : ''} ${tick.quote}` : '—'}
          </b>
          <span className="hint">Live public price feed</span>
        </section>
      </div>
    </div>
  );
}
