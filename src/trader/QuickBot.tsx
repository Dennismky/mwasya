import { useState, type CSSProperties } from 'react';
import { RunCard } from '../components/RunCard';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import type { PublishedBot } from '../lib/tenant';
import { contractLabel, marketLabel, type BotSpec } from '../shared/botSpec';
import { useTrader } from './TraderApp';

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

/** Published Bot Forge bots — Deriv runs them server-side on the client's own account. */
export default function QuickBot() {
  const { bots, runner, preview } = useTrader();
  const auth = useAuth();
  const [error, setError] = useState('');
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
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Quick Bot</h1>
        <p className="muted">Pick a bot and press Run. Each bot stops at its own profit and loss limits, or when you press Stop.</p>
      </div>
      {runner.conn === 'error' && <p className="error" role="alert">Can't reach your Deriv account: {runner.connError}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {bots.length === 0 ? <section className="card"><p className="muted">No bots yet. Check back soon.</p></section> : (
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
                <button className="btn btn-primary" disabled={preview || runner.conn !== 'ready' || runner.launch.phase === 'starting'} onClick={() => run(bot)}>
                  <Icon.Chip /> {preview ? 'Clients press Run here' : mine?.phase === 'starting' ? 'Starting…' : `Run on ${account?.isVirtual ? 'demo' : 'real'}`}
                </button>
                <div aria-live="polite">
                  {!preview && runner.conn === 'connecting' && <span className="hint"><span className="spinner" />Connecting to your account…</span>}
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
    </div>
  );
}
