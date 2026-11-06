import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { RunCard } from '../components/RunCard';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import type { PublishedBot } from '../lib/tenant';
import { contractLabel, marketLabel, type BotSpec } from '../shared/botSpec';
import { useTrader } from './TraderApp';
import { BOT_MARKETS, isBotMarket, useMarket } from './market';
import { decimalsOf, lastDigit, symbolName, useTicks } from './ticks';
import { DEFAULT_CONFIG, type BotConfig } from './botEngine';
import { StrategyFields, contractName, strategyProblems } from './StrategyForm';

// EDIT HERE: how many recent ticks the percentages on each Quick Bot card are worked out from.
const STATS_TICKS = 1000;

/** Which last digits win for a digit contract (null for contracts that don't settle on the last digit). */
function winningDigits(type: string, barrier?: string): ((d: number) => boolean) | null {
  const b = Number(barrier ?? 0);
  if (type === 'DIGITOVER') return (d) => d > b;
  if (type === 'DIGITUNDER') return (d) => d < b;
  if (type === 'DIGITMATCH') return (d) => d === b;
  if (type === 'DIGITDIFF') return (d) => d !== b;
  if (type === 'DIGITEVEN') return (d) => d % 2 === 0;
  if (type === 'DIGITODD') return (d) => d % 2 === 1;
  return null;
}

const RISK_LABEL = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const RISK_STYLE: Record<PublishedBot['risk'], CSSProperties> = {
  low: { background: 'var(--success-tint)', color: 'var(--success)' },
  medium: { background: '#FFF4DB', color: '#8A5A00' },
  high: { background: 'var(--danger-tint)', color: 'var(--danger)' },
};

function describe(spec: BotSpec) {
  const k = spec.contract;
  const what = `${contractLabel(k.contract_type)}${k.barrier ? ` ${k.barrier}` : ''} · ${isBotMarket(k.underlying_symbol) ? symbolName(k.underlying_symbol) : marketLabel(k.underlying_symbol)}`;
  const len = k.contract_type === 'ACCU' ? `Accumulator ${((k.growth_rate ?? 0) * 100).toFixed(0)}%` : `${k.duration} ${k.duration_unit === 't' ? 'tick' : k.duration_unit === 's' ? 'sec' : 'min'}${k.duration === 1 ? '' : 's'}`;
  const after = spec.strategy === 'fixed' ? 'Same stake every trade'
    : spec.strategy === 'martingale' ? `Stake ×${spec.params.multiplier ?? 2} after a loss (max ${spec.params.max_stake})`
    : `Stake +${spec.params.unit} after a loss (max ${spec.params.max_stake})`;
  return { what, len, after };
}

/** Published Bot Forge bots — Deriv runs them server-side on the client's own account. */
export default function QuickBot() {
  const { bots, runner, preview, bot: engine, site, autoStop, setAutoStop } = useTrader();
  const auth = useAuth();
  const [error, setError] = useState('');
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const runList = Object.values(runner.runs).sort((a, b) => b.start_time - a.start_time);
  // One market for every bot: the one the client analyses in D-Circles / Charts. Volatility bots run on it, so a bot
  // never trades a different volatility than the one studied. Bots built for other markets keep their own.
  const [market, setMarket] = useMarket();
  const statsMarket = isBotMarket(market) ? market : '1HZ100V';
  const { prices, ready } = useTicks(statsMarket, STATS_TICKS);
  const stats = useMemo(() => {
    const dec = decimalsOf(prices);
    const digits = prices.map((p) => lastDigit(p, dec));
    const count = Array(10).fill(0) as number[];
    digits.forEach((d) => count[d]++);
    const total = digits.length || 1;
    let rises = 0, moves = 0;
    for (let i = 1; i < prices.length; i++) if (prices[i] !== prices[i - 1]) { moves++; if (prices[i] > prices[i - 1]) rises++; }
    return { pct: count.map((c) => (c / total) * 100), n: digits.length, last: digits[digits.length - 1], rise: moves ? (rises / moves) * 100 : 50 };
  }, [prices]);
  const specFor = (bot: PublishedBot): BotSpec => {
    const own = bot.spec.contract.underlying_symbol;
    return { ...bot.spec, contract: { ...bot.spec.contract, currency, underlying_symbol: isBotMarket(own) && isBotMarket(market) ? market : own } };
  };

  const run = (bot: PublishedBot) => {
    if (!account) return;
    const spec = specFor(bot);
    if (!account.isVirtual && !confirm(`Run "${bot.name}" on your real account?\n\nMarket: ${symbolName(spec.contract.underlying_symbol)}\nIt follows its own take profit and stop loss limits.`)) return;
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
      {/* EDIT HERE: the market every Quick Bot runs on (shared with D-Circles, Charts, Signals and Bot Builder). */}
      <section className="card qb-market">
        <label className="label" htmlFor="qb-market">Market</label>
        <select id="qb-market" className="input" value={statsMarket} onChange={(e) => setMarket(e.target.value)}>
          {BOT_MARKETS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <span className="hint">Bots run on this market, the same one you analyse in D-Circles and Charts. Percentages: last {stats.n || STATS_TICKS} ticks, live.</span>
      </section>
      <CreateBot market={statsMarket} currency={currency} stats={stats} ready={ready} engine={engine} siteKey={site.subdomain} preview={preview} isReal={!!account && !account.isVirtual} autoStop={autoStop} setAutoStop={setAutoStop} />

      {runner.conn === 'error' && <p className="error" role="alert">Can't reach your Deriv account: {runner.connError}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {bots.length === 0 ? <section className="card"><p className="muted">No bots yet. Check back soon.</p></section> : (
        <div className="grid">
          {bots.map((bot) => {
            const spec = specFor(bot);
            const d = describe(spec);
            const wins = spec.contract.underlying_symbol === statsMarket ? winningDigits(spec.contract.contract_type, spec.contract.barrier) : null;
            const upDown = spec.contract.underlying_symbol === statsMarket && (spec.contract.contract_type === 'CALL' || spec.contract.contract_type === 'PUT');
            const winPct = wins ? stats.pct.reduce((s, p, dg) => s + (wins(dg) ? p : 0), 0) : upDown ? (spec.contract.contract_type === 'CALL' ? stats.rise : 100 - stats.rise) : null;
            const p = bot.spec.params;
            const mine = runner.launch.key === bot.id ? runner.launch : null;
            return (
              <article key={bot.id} className="card stack" style={{ gap: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <h2 style={{ fontSize: 18, fontWeight: 700 }}>{bot.name}</h2>
                  <span className="badge" style={RISK_STYLE[bot.risk]}>{RISK_LABEL[bot.risk]}</span>
                </div>
                <span className="hint">{d.what} · {d.len}</span>
                {winPct !== null && (
                  <div className="qb-stats" aria-label="Live statistics">
                    <div className="qb-win"><b className="mono">{ready ? `${winPct.toFixed(1)}%` : '…'}</b><span>{!ready || !stats.n ? `Loading the last ${STATS_TICKS} ticks…` : wins ? `of the last ${stats.n} ticks ended on a winning digit` : `of the last ${stats.n} tick moves went this way`}</span></div>
                    {wins && (
                      <div className="qb-digits">
                        {stats.pct.map((p, dg) => (
                          <span key={dg} className={`${wins(dg) ? 'win' : ''} ${stats.last === dg ? 'live' : ''}`} title={`Digit ${dg}: ${p.toFixed(1)}%`}>
                            <b>{dg}</b><small className="mono">{ready ? p.toFixed(1) : '…'}</small>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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

/**
 * "Create your bot": the client sets contract, digit, ticks, entry digit, stake, martingale and limits, then runs it at once.
 * It trades from this browser on the client's own Deriv account, buying in a single request so it catches the tick it waits for.
 * Results show in the Summary / Transactions / Journal panel.
 */
function CreateBot({ market, currency, stats, ready, engine, siteKey, preview, isReal, autoStop, setAutoStop }: {
  market: string; currency: string; stats: { pct: number[]; n: number; rise: number }; ready: boolean;
  engine: ReturnType<typeof useTrader>['bot']; siteKey: string; preview: boolean; isReal: boolean; autoStop: boolean; setAutoStop: (on: boolean) => void;
}) {
  // EDIT HERE: settings a new client starts with in "Create your bot".
  const key = `mw_qb_own_${siteKey}`;
  const [cfg, setCfg] = useState<BotConfig>(() => {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(key) ?? '{}'), symbol: market }; } catch { return { ...DEFAULT_CONFIG, symbol: market }; }
  });
  const [open, setOpen] = useState(() => localStorage.getItem(`${key}_open`) !== '0');
  useEffect(() => { setCfg((c) => (c.symbol === market ? c : { ...c, symbol: market })); }, [market]);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(cfg)); } catch { /* storage full */ } }, [cfg, key]);
  const problems = strategyProblems(cfg);
  const running = engine.state !== 'idle';
  const wins = winningDigits(cfg.contract, String(cfg.prediction));
  const winPct = wins ? stats.pct.reduce((s, p, d) => s + (wins(d) ? p : 0), 0) : cfg.contract === 'CALL' ? stats.rise : 100 - stats.rise;
  const s = engine.summary;

  const run = () => {
    if (isReal && !confirm(`Run your bot on your REAL account?\n\nMarket: ${symbolName(cfg.symbol)}\n${contractName(cfg)} · ${cfg.ticks} tick${cfg.ticks === 1 ? '' : 's'} · stake ${cfg.stake} ${currency}\nStops at +${cfg.takeProfit} / −${cfg.stopLoss} ${currency}.`)) return;
    void engine.run({ ...cfg, symbol: market });
  };
  const toggle = () => { setOpen((o) => { localStorage.setItem(`${key}_open`, o ? '0' : '1'); return !o; }); };

  return (
    <section className={`card qb-create ${running ? 'running' : ''}`} aria-label="Create your bot">
      <header className="qb-create-head">
        <div>
          <h2>⚡ Create your bot</h2>
          <p className="hint">Your own settings, on {symbolName(market)}. Buys in one request, so it catches the tick you wait for.</p>
        </div>
        <button className="btn btn-ghost" onClick={toggle} aria-expanded={open}>{open ? 'Hide settings' : 'Show settings'}</button>
      </header>
      {open && <StrategyFields cfg={cfg} setCfg={setCfg} currency={currency} market={false} disabled={running} />}
      <div className="qb-create-foot">
        <div className="qb-win"><b className="mono">{ready && stats.n ? `${winPct.toFixed(1)}%` : '…'}</b><span>{contractName(cfg)} · of the last {stats.n || 1000} ticks</span></div>
        {running && <span className="mono qb-live">{s.runs} runs · <b style={{ color: s.pnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{s.pnl >= 0 ? '+' : ''}{s.pnl.toFixed(2)} {currency}</b></span>}
        <label className="bw-autostop" title="Stops after the open trade when you switch browser tab, minimise, lock your phone, or open a page other than the bots.">
          <input type="checkbox" checked={autoStop} onChange={(e) => setAutoStop(e.target.checked)} />
          <span className="bw-switch" aria-hidden="true" />Stop when I leave
        </label>
        {running
          ? <button className="bw-run stop" disabled={engine.state === 'stopping'} onClick={engine.stop}>■ {engine.state === 'stopping' ? 'Stopping…' : 'Stop'}</button>
          : <button className="bw-run" disabled={preview || problems.length > 0} onClick={run} title={problems[0]}>▶ Run my bot</button>}
      </div>
      {problems[0] && !running && <p className="error">{problems[0]}</p>}
      {preview && <p className="hint">Clients run their bot here after logging in.</p>}
    </section>
  );
}
