import { useEffect, useState, type CSSProperties } from 'react';
import { Navigate } from 'react-router-dom';
import { RunCard } from '../components/RunCard';
import { Icon } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { reloadTenant, type PublishedBot, type SiteBranding } from '../lib/tenant';
import { useBotRunner } from '../lib/useBotRunner';
import { contractLabel, marketLabel, type BotSpec } from '../shared/botSpec';

/** `/app` on a trader site (<sub>.mwasya.site): the operator's published bots, run on the trader's own account. */
export default function TraderHome({ site, bots: initialBots }: { site: SiteBranding; bots: PublishedBot[] }) {
  return (
    <AuthProvider>
      <TraderView site={site} initialBots={initialBots} />
    </AuthProvider>
  );
}

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const RISK_STYLE: Record<PublishedBot['risk'], CSSProperties> = {
  low: { background: 'var(--success-tint)', color: 'var(--success)' },
  medium: { background: '#FFF4DB', color: '#8A5A00' },
  high: { background: 'var(--danger-tint)', color: 'var(--danger)' },
};

function describe(spec: BotSpec) {
  const k = spec.contract;
  const what = `${contractLabel(k.contract_type)}${k.barrier ? ` ${k.barrier}` : ''} · ${marketLabel(k.underlying_symbol)}`;
  const len = k.contract_type === 'ACCU' ? `Accumulator ${((k.growth_rate ?? 0) * 100).toFixed(0)}%` : `${k.duration} ${k.duration_unit === 't' ? 'tick' : k.duration_unit === 's' ? 'sec' : 'min'}${k.duration === 1 ? '' : 's'}`;
  const after = spec.strategy === 'fixed' ? 'Same stake every trade'
    : spec.strategy === 'martingale' ? `Stake ×${spec.params.multiplier ?? 2} after a loss (max ${spec.params.max_stake})`
    : `Stake +${spec.params.unit} after a loss (max ${spec.params.max_stake})`;
  return { what, len, after };
}

function TraderView({ site, initialBots }: { site: SiteBranding; initialBots: PublishedBot[] }) {
  const auth = useAuth();
  const [bots, setBots] = useState(initialBots);
  const [error, setError] = useState('');
  const runner = useBotRunner(auth.account?.id, auth.expire, auth.refreshBalance);
  const dark = site.theme === 'dark';

  useEffect(() => { // pick up bots the operator published since the page loaded
    reloadTenant().then((t) => { if (t.kind === 'site') setBots(t.bots); }).catch(() => undefined);
  }, []);

  if (auth.status === 'signed-out') return <Navigate to="/" replace state={{ from: '/app', error: auth.error }} />;
  if (auth.status === 'checking') return <div className="shell-loading"><span className="spinner" /> Loading…</div>;

  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const runList = Object.values(runner.runs).sort((a, b) => b.start_time - a.start_time);

  const run = (bot: PublishedBot) => {
    if (!account) return;
    const spec: BotSpec = { ...bot.spec, contract: { ...bot.spec.contract, currency } };
    if (!account.isVirtual && !confirm(`Run "${bot.name}" on your REAL account?\n\nYou can lose up to ${spec.params.stop_loss} ${currency}. Losses are not guaranteed to stop exactly at that amount.`)) return;
    setError('');
    void runner.start(spec, bot.id);
  };
  const control = (a: 'pause' | 'resume' | 'stop', id: string) => runner.control(a, id).then((e) => { if (e) setError(e); });

  return (
    <div style={{ minHeight: '100vh', background: dark ? '#0B1F3A' : 'var(--bg-alt)', '--primary': site.accent, '--primary-hover': site.accent } as CSSProperties}>
      <header className="topbar" style={{ background: dark ? 'rgba(11,31,58,.92)' : undefined, borderColor: dark ? 'rgba(255,255,255,.08)' : undefined }}>
        <span className="brand-mark" style={{ background: site.accent }}>{site.name.charAt(0).toUpperCase()}</span>
        <b style={{ fontSize: 18, color: dark ? '#fff' : undefined }}>{site.name}</b>
        <span style={{ flex: 1 }} />
        {auth.accounts.length > 0 && (
          <select className="input" style={{ width: 'auto', padding: '8px 12px' }} aria-label="Trading account" value={account?.id ?? ''} onChange={(e) => auth.setAccountId(e.target.value)}>
            {auth.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        )}
        <div className="balance-chip">
          <span className={`dot ${account?.isVirtual ? 'dot-demo' : 'dot-real'}`} />
          <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>{account?.isVirtual ? 'DEMO' : 'REAL'}</span>
          <b className="mono">{auth.balance}</b>
        </div>
        <button className="btn btn-secondary" onClick={auth.signOut}>Log out</button>
      </header>

      <main className="container stack" style={{ padding: '32px 24px 64px', gap: 24 }}>
        <div className="stack" style={{ gap: 6, color: dark ? '#fff' : undefined }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Bots</h1>
          <p style={{ color: dark ? '#C9D3E3' : 'var(--muted)' }}>Pick a bot and run it on your account. Every bot stops at its own profit and loss limits.</p>
        </div>

        {account?.isVirtual === false && (
          <div className="notice" style={{ background: 'var(--danger-tint)', borderColor: '#F5C2BD' }}>
            <span><b>Real money.</b> You're on a real account. Switch to Demo in the top bar to practise first.</span>
          </div>
        )}
        {runner.conn === 'error' && <p className="error" role="alert">Can't reach your Deriv account: {runner.connError}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {bots.length === 0 ? (
          <section className="card"><p className="muted">No bots are available yet. Check back soon.</p></section>
        ) : (
          <div className="grid">
            {bots.map((bot) => {
              const d = describe(bot.spec);
              const p = bot.spec.params;
              const mine = runner.launch.key === bot.id ? runner.launch : null;
              return (
                <article key={bot.id} className="card stack" style={{ gap: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <h2 style={{ fontSize: 18, fontWeight: 700 }}>{bot.name}</h2>
                    <span className="badge" style={RISK_STYLE[bot.risk]}>{RISK_LABEL[bot.risk]}</span>
                  </div>
                  <span className="hint">{d.what} · {d.len}</span>
                  <dl className="bot-facts">
                    <div><dt>Stake</dt><dd className="mono">{p.initial_stake} {currency}</dd></div>
                    <div><dt>Take profit</dt><dd className="mono">{p.take_profit} {currency}</dd></div>
                    <div><dt>Stop loss</dt><dd className="mono">{p.stop_loss} {currency}</dd></div>
                    <div><dt>Max trades</dt><dd className="mono">{p.max_contracts}</dd></div>
                  </dl>
                  <span className="hint">{d.after}</span>
                  <button className="btn btn-primary" style={{ background: site.accent }} disabled={runner.conn !== 'ready' || runner.launch.phase === 'starting'} onClick={() => run(bot)}>
                    <Icon.Chip /> {mine?.phase === 'starting' ? 'Starting…' : `Run on ${account?.isVirtual ? 'demo' : 'real'}`}
                  </button>
                  <div aria-live="polite">
                    {runner.conn === 'connecting' && <span className="hint"><span className="spinner" />Connecting to your account…</span>}
                    {mine?.phase === 'error' && <p className="error" role="alert">{mine.message}</p>}
                    {mine?.phase === 'running' && runner.runs[mine.runId] && (
                      <RunCard run={runner.runs[mine.runId]} currency={currency} compact
                        onPause={() => control('pause', mine.runId)} onResume={() => control('resume', mine.runId)} onStop={() => control('stop', mine.runId)} />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {runList.length > 0 && (
          <section className="card stack" style={{ gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Your runs</h2>
            {runList.map((r) => <RunCard key={r.run_id} run={r} currency={currency}
              onPause={() => control('pause', r.run_id)} onResume={() => control('resume', r.run_id)} onStop={() => control('stop', r.run_id)} />)}
          </section>
        )}

        <p className="hint" style={{ textAlign: 'center', color: dark ? '#8FA0BA' : undefined }}>
          Trading carries risk. Bots do not guarantee profit. Only trade with money you can afford to lose.
        </p>
      </main>
    </div>
  );
}
