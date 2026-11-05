import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InfoTip, TIPS } from '../components/InfoTip';
import { Icon } from '../components/ui';
import { toast } from '../components/motion';
import { parseDerivXml, type LoadedBot } from './xmlBot';

const BlockEditor = lazy(() => import('./BlockEditor'));
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { DEFAULT_CONFIG, useBotEngine, type BotConfig } from './botEngine';
import { useTrader } from './TraderApp';
import { SYMBOLS, decimalsOf, lastDigit, symbolName, useTicks } from './ticks';

const CONTRACTS: { id: BotConfig['contract']; label: string; digit?: boolean }[] = [
  { id: 'DIGITOVER', label: 'Over', digit: true }, { id: 'DIGITUNDER', label: 'Under', digit: true },
  { id: 'DIGITMATCH', label: 'Matches', digit: true }, { id: 'DIGITDIFF', label: 'Differs', digit: true },
  { id: 'DIGITEVEN', label: 'Even' }, { id: 'DIGITODD', label: 'Odd' },
  { id: 'CALL', label: 'Rise' }, { id: 'PUT', label: 'Fall' },
];
type Panel = 'summary' | 'transactions' | 'journal';
const num = (v: string, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export default function BotBuilder() {
  const { site, xmlBots } = useTrader();
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const preview = account?.id === PREVIEW_ACCOUNT_ID;
  const key = `mw_bot_${site.subdomain}`;
  const [cfg, setCfg] = useState<BotConfig>(() => {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return DEFAULT_CONFIG; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(cfg)); }, [key, cfg]);
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  // Load a bot: import a Deriv Bot XML file, or pick one of the site's free bots.
  const [loaded, setLoaded] = useState<Pick<LoadedBot, 'name' | 'params' | 'notes'> | null>(() => {
    try { return JSON.parse(localStorage.getItem(`${key}_name`) ?? 'null'); } catch { return null; }
  });
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [params, setParams] = useSearchParams();
  const [botXml, setBotXml] = useState<string>(() => localStorage.getItem(`${key}_xml`) ?? '');
  const [view, setView] = useState<'blocks' | 'settings'>(() => (localStorage.getItem(`${key}_xml`) ? 'blocks' : 'settings'));
  const applyBot = (b: LoadedBot) => {
    setCfg(b.config);
    const meta = { name: b.name, params: b.params, notes: b.notes };
    setLoaded(meta);
    localStorage.setItem(`${key}_name`, JSON.stringify(meta));
    try { localStorage.setItem(`${key}_xml`, b.xml); } catch { /* storage full: blocks still show this session */ }
    setBotXml(b.xml);
    setView('blocks');
    toast(`${b.name} loaded`);
  };
  // Edits in the block editor flow back into the run settings.
  const onBlocksChange = (xml: string) => {
    try { localStorage.setItem(`${key}_xml`, xml); } catch { /* ignore */ }
    try {
      const b = parseDerivXml(xml, loaded?.name ?? 'Bot');
      setCfg(b.config);
      const meta = { name: loaded?.name ?? b.name, params: b.params, notes: b.notes };
      setLoaded(meta);
      localStorage.setItem(`${key}_name`, JSON.stringify(meta));
    } catch { /* half-edited workspace: keep the last good settings */ }
  };
  const importFile = async (f: File) => {
    setLoadError('');
    if (f.size > 2_000_000) return setLoadError('That file is too large for a bot file.');
    setImporting(true);
    try { applyBot(parseDerivXml(await f.text(), f.name)); } catch (e) { setLoadError((e as Error).message); } finally { setImporting(false); }
  };
  const loadFree = async (id: string) => {
    setLoadError(''); setImporting(true);
    try {
      const r = await fetch(`/api/xmlbots/download?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('Could not load that bot.');
      applyBot(parseDerivXml(await r.text(), xmlBots.find((x) => x.id === id)?.name ?? 'Free bot'));
    } catch (e) { setLoadError((e as Error).message); } finally { setImporting(false); }
  };
  useEffect(() => {
    const id = params.get('bot');
    if (!id) return;
    setParams({}, { replace: true });
    void loadFree(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const bot = useBotEngine(account?.id, currency, auth.refreshBalance);
  const [panel, setPanel] = useState<Panel>('summary');
  const isDigit = CONTRACTS.find((c) => c.id === cfg.contract)?.digit ?? false;
  const running = bot.state !== 'idle';

  // Digit statistics over the last 60 ticks of the chosen market.
  const { prices } = useTicks(cfg.symbol, 60);
  const stats = useMemo(() => {
    const d = decimalsOf(prices);
    const digits = prices.map((p) => lastDigit(p, d));
    const count = Array(10).fill(0) as number[];
    digits.forEach((x) => count[x]++);
    const n = digits.length || 1;
    const order = count.map((c, i) => ({ i, pct: (c / n) * 100 })).sort((a, b) => b.pct - a.pct);
    const over = (digits.filter((x) => x > cfg.prediction).length / n) * 100;
    return { order, over, under: 100 - over, n: digits.length };
  }, [prices, cfg.prediction]);

  const problems: string[] = [];
  if (!(cfg.stake >= 0.35)) problems.push('Stake must be at least 0.35');
  if (cfg.contract === 'DIGITOVER' && cfg.prediction > 8) problems.push('Over needs a digit from 0 to 8');
  if (cfg.contract === 'DIGITUNDER' && cfg.prediction < 1) problems.push('Under needs a digit from 1 to 9');
  if (!(cfg.stopLoss > 0)) problems.push('Set a stop loss');
  const addMode = cfg.recoveryMode === 'add';
  if (cfg.recovery && !addMode && !(cfg.multiplier > 1 && cfg.multiplier <= 5)) problems.push('Martingale must be above 1 and at most 5');
  if (cfg.recovery && addMode && !(cfg.multiplier > 0 && cfg.multiplier <= 5)) problems.push('Loss recovery must be above 0 and at most 5');
  const markets = SYMBOLS.filter((s) => /^(1HZ|R_)/.test(s.id) || s.id === cfg.symbol);

  return (
    <div className="bb">
      <div className="bb-steps">
        <section className={`bb-step bb-load card ${loaded ? 'has' : ''}`}>
          <header><span><Icon.Code /></span><b>{loaded ? loaded.name : 'Load a bot'}</b>
            {loaded && <button className="btn btn-ghost bb-clear" disabled={running} onClick={() => { setLoaded(null); setBotXml(""); setView("settings"); localStorage.removeItem(`${key}_name`); localStorage.removeItem(`${key}_xml`); }}>Clear</button>}
          </header>
          <div className="bb-load-row">
            <label className={`btn btn-primary bb-import ${running || importing ? 'disabled' : ''}`}>
              <Icon.Download /> {importing ? 'Reading…' : 'Import XML'}
              <input type="file" accept=".xml,text/xml,application/xml" hidden disabled={running || importing} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
            </label>
            {xmlBots.length > 0 && (
              <select className="input" aria-label="Free bots" disabled={running || importing} value="" onChange={(e) => e.target.value && void loadFree(e.target.value)}>
                <option value="">Choose a free bot…</option>
                {xmlBots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            )}
          </div>
          {loadError && <p className="error">{loadError}</p>}
          {loaded && (
            <>
              <div className="bb-tags">
                <span>{symbolName(cfg.symbol)}</span>
                <span>{CONTRACTS.find((c) => c.id === cfg.contract)?.label}{isDigit ? ` ${cfg.prediction}` : ''}</span>
                <span>{cfg.ticks} tick{cfg.ticks === 1 ? '' : 's'}</span>
                <span>Stake {cfg.stake}</span>
                {cfg.recovery && <span>{addMode ? `Recovery +loss ×${cfg.multiplier}` : `Martingale ×${cfg.multiplier}`}</span>}
                <span className="ok">TP {cfg.takeProfit}</span>
                <span className="bad">SL {cfg.stopLoss}</span>
              </div>
              {loaded.params.length > 0 && (
                <div className="bb-params">
                  {loaded.params.map((p) => <div key={p.name}><small>{p.name}</small><b className="mono">{p.value}</b></div>)}
                </div>
              )}
              {loaded.notes.map((n) => <p key={n} className="hint">• {n}</p>)}
              {botXml && (
                <div className="seg bb-view" role="tablist" aria-label="Bot view">
                  <button role="tab" aria-selected={view === 'blocks'} className={view === 'blocks' ? 'on' : ''} onClick={() => setView('blocks')}>Blocks</button>
                  <button role="tab" aria-selected={view === 'settings'} className={view === 'settings' ? 'on' : ''} onClick={() => setView('settings')}>Quick settings</button>
                </div>
              )}
            </>
          )}
        </section>

        {view === 'blocks' && botXml ? (
          <section className="card bb-blocks">
            <Suspense fallback={<div className="bb-blocks-wait"><span className="spinner" /> Opening the bot…</div>}>
              <BlockEditor xml={botXml} readOnly={running} onChange={onBlocksChange} />
            </Suspense>
          </section>
        ) : (<>
        <Step n={1} title="Market & contract">
          <div className="field">
            <label className="label" htmlFor="bb-sym">Market</label>
            <select id="bb-sym" className="input" value={cfg.symbol} disabled={running} onChange={(e) => set('symbol', e.target.value)}>
              {markets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="seg bb-seg" role="group" aria-label="Contract">
            {CONTRACTS.map((c) => <button key={c.id} disabled={running} className={cfg.contract === c.id ? 'on' : ''} aria-pressed={cfg.contract === c.id} onClick={() => set('contract', c.id)}>{c.label}</button>)}
          </div>
          {isDigit && (
            <div className="field">
              <span className="label">Prediction <InfoTip>{TIPS.digit}</InfoTip></span>
              <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} disabled={running} className={cfg.prediction === d ? 'on' : ''} aria-pressed={cfg.prediction === d} onClick={() => set('prediction', d)}>{d}</button>)}</div>
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="bb-ticks">Duration: {cfg.ticks} tick{cfg.ticks === 1 ? '' : 's'} <InfoTip>{TIPS.duration}</InfoTip></label>
            <input id="bb-ticks" type="range" min={1} max={10} disabled={running} value={cfg.ticks} onChange={(e) => set('ticks', Number(e.target.value))} />
          </div>
        </Step>

        <Step n={2} title="Entry">
          <label className="bb-check"><input type="checkbox" disabled={running} checked={cfg.entryDigit === null} onChange={(e) => set('entryDigit', e.target.checked ? null : 5)} /> Buy straight away</label>
          {cfg.entryDigit !== null && (
            <div className="field">
              <span className="label">Buy right after a tick ending in</span>
              <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} disabled={running} className={cfg.entryDigit === d ? 'on' : ''} onClick={() => set('entryDigit', d)}>{d}</button>)}</div>
            </div>
          )}
        </Step>

        <Step n={3} title="Stake & recovery">
          <div className="bb-row">
            <Field id="bb-stake" label="Initial stake" tip={TIPS.stake} value={cfg.stake} suffix={currency} disabled={running} onChange={(v) => set('stake', num(v))} />
          </div>
          <label className="bb-check"><input type="checkbox" disabled={running} checked={cfg.recovery} onChange={(e) => set('recovery', e.target.checked)} /> Raise the stake after a loss</label>
          {cfg.recovery && (
            <div className="seg" role="group" aria-label="Recovery">
              <button disabled={running} className={!addMode ? 'on' : ''} aria-pressed={!addMode} onClick={() => setCfg((c) => ({ ...c, recoveryMode: 'multiply', multiplier: c.multiplier > 1 ? c.multiplier : 2 }))}>Martingale</button>
              <button disabled={running} className={addMode ? 'on' : ''} aria-pressed={addMode} onClick={() => setCfg((c) => ({ ...c, recoveryMode: 'add' }))}>Add the loss</button>
            </div>
          )}
          {cfg.recovery && (
            <div className="bb-row">
              <Field id="bb-mult" label={addMode ? 'Next stake + loss ×' : 'Martingale (multiply by)'} value={cfg.multiplier} suffix="×" disabled={running} onChange={(v) => set('multiplier', num(v, addMode ? 1 : 2))} />
              <Field id="bb-max" label="Max stake" value={cfg.maxStake} suffix={currency} disabled={running} onChange={(v) => set('maxStake', num(v))} />
            </div>
          )}
        </Step>

        <Step n={4} title="Limits">
          <div className="bb-row">
            <Field id="bb-tp" label="Take profit" tip={TIPS.takeProfit} value={cfg.takeProfit} suffix={currency} disabled={running} onChange={(v) => set('takeProfit', num(v))} />
            <Field id="bb-sl" label="Stop loss" tip={TIPS.stopLoss} value={cfg.stopLoss} suffix={currency} disabled={running} onChange={(v) => set('stopLoss', num(v))} />
            <Field id="bb-runs" label="Max runs (0 = none)" value={cfg.maxRuns} disabled={running} onChange={(v) => set('maxRuns', Math.max(0, Math.floor(num(v))))} />
          </div>
        </Step>
        </>)}
      </div>

      <aside className="bb-panel card">
        <div className="bb-stats">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Digit stats</b><span className="hint">last {stats.n} ticks</span></div>
          <div className="bb-chips">
            {stats.order.map((o, idx) => (
              <span key={o.i} className={`bb-chip ${idx === 0 ? 'hot' : idx === 9 ? 'cold' : ''}`} title={`${o.pct.toFixed(1)}%`}>
                <b>{o.i}</b><small>{o.pct.toFixed(0)}%</small>
              </span>
            ))}
          </div>
          {isDigit && (
            <div className="bb-split">
              <span>Over {cfg.prediction}: <b>{stats.over.toFixed(1)}%</b></span>
              <span>Under/equal {cfg.prediction}: <b>{stats.under.toFixed(1)}%</b></span>
            </div>
          )}
        </div>

        <div className="seg" role="tablist" aria-label="Bot panel">
          {(['summary', 'transactions', 'journal'] as const).map((p) => <button key={p} role="tab" aria-selected={panel === p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
        </div>

        <div className="bb-body">
          {panel === 'summary' && (
            <div className="bb-summary">
              <Stat k="Total stake" v={`${bot.summary.stake.toFixed(2)} ${currency}`} />
              <Stat k="Total payout" v={`${bot.summary.payout.toFixed(2)} ${currency}`} />
              <Stat k="Runs" v={String(bot.summary.runs)} />
              <Stat k="Won" v={String(bot.summary.won)} tone="ok" />
              <Stat k="Lost" v={String(bot.summary.lost)} tone="bad" />
              <Stat k="Profit/loss" v={`${bot.summary.pnl >= 0 ? '+' : ''}${bot.summary.pnl.toFixed(2)}`} tone={bot.summary.pnl >= 0 ? 'ok' : 'bad'} />
            </div>
          )}
          {panel === 'transactions' && (bot.trades.length === 0 ? <p className="muted bb-empty">Trades appear here when the bot runs.</p> : (
            <ul className="bb-list">
              {bot.trades.map((t) => (
                <li key={t.id} className={`bb-tx ${t.status}`}>
                  <span className="bb-dot" />
                  <span className="stack" style={{ minWidth: 0 }}><b>{t.type}</b><small className="mono hint">{t.entry ? `${t.entry} → ${t.exit ?? '…'}` : `#${t.id}`}</small></span>
                  <span className="stack" style={{ alignItems: 'flex-end' }}><small className="mono">{t.stake.toFixed(2)}</small>
                    <b className="mono">{t.status === 'open' ? '…' : `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`}</b></span>
                </li>
              ))}
            </ul>
          ))}
          {panel === 'journal' && (bot.journal.length === 0 ? <p className="muted bb-empty">Every step the bot takes is logged here.</p> : (
            <ul className="bb-list bb-journal">
              {bot.journal.map((j, i) => (
                <li key={i} className={`bb-j ${j.level}`}><small className="mono">{new Date(j.t).toLocaleTimeString()}</small><span>{j.text}</span></li>
              ))}
            </ul>
          ))}
        </div>
        <button className="btn btn-ghost" disabled={running} onClick={bot.reset}>Reset</button>
      </aside>

      <div className="bb-runbar">
        {problems.length > 0 && !running && <span className="error">{problems[0]}</span>}
        {preview && <span className="hint">Clients run the bot here after logging in.</span>}
        <span style={{ flex: 1 }} />
        <span className={`bb-status ${running ? 'on' : ''}`}><span className="bb-pulse" />{bot.state === 'running' ? 'Bot running' : bot.state === 'stopping' ? 'Stopping…' : 'Bot is not running'}</span>
        {running
          ? <button className="btn bb-stop" disabled={bot.state === 'stopping'} onClick={bot.stop}>■ Stop</button>
          : <button className="btn bb-run" disabled={preview || problems.length > 0} onClick={() => {
              if (account && !account.isVirtual && !confirm(`Run this bot on your REAL account? You can lose up to ${cfg.stopLoss} ${currency}.`)) return;
              setPanel('transactions'); void bot.run(cfg);
            }}>▶ Run</button>}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bb-step card">
      <header><span>{n}</span><b>{title}</b></header>
      <div className="stack" style={{ gap: 14 }}>{children}</div>
    </section>
  );
}

function Field({ id, label, value, onChange, suffix, tip, disabled }: { id: string; label: string; value: number; onChange: (v: string) => void; suffix?: string; tip?: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="field" style={{ flex: 1, minWidth: 130 }}>
      <label className="label" htmlFor={id}>{label}{tip && <InfoTip>{tip}</InfoTip>}</label>
      <div className="input-group">
        <input id={id} className="input mono" inputMode="decimal" disabled={disabled} value={text} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setText(v); onChange(v); }} />
        {suffix && <span className="addon">{suffix}</span>}
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  return <div className="bb-stat"><small>{k}</small><b className="mono" style={{ color: tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{v}</b></div>;
}
