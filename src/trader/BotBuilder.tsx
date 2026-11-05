import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { InfoTip, TIPS } from '../components/InfoTip';
import { toast } from '../components/motion';
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { MENU, configToXml } from './blocks';
import type { EditorApi } from './BlockEditor';
import { DEFAULT_CONFIG, useBotEngine, type BotConfig } from './botEngine';
import { useTrader } from './TraderApp';
import { SYMBOLS } from './ticks';
import { parseDerivXml, setXmlVariable, type LoadedBot } from './xmlBot';

const BlockEditor = lazy(() => import('./BlockEditor'));

const CONTRACTS: { id: BotConfig['contract']; label: string; digit?: boolean }[] = [
  { id: 'DIGITOVER', label: 'Over', digit: true }, { id: 'DIGITUNDER', label: 'Under', digit: true },
  { id: 'DIGITMATCH', label: 'Matches', digit: true }, { id: 'DIGITDIFF', label: 'Differs', digit: true },
  { id: 'DIGITEVEN', label: 'Even' }, { id: 'DIGITODD', label: 'Odd' },
  { id: 'CALL', label: 'Rise' }, { id: 'PUT', label: 'Fall' },
];
type Panel = 'summary' | 'transactions' | 'journal';
type Meta = Pick<LoadedBot, 'name' | 'params' | 'notes'>;
const num = (v: string, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const pretty = (t: string) => t.replace(/^trade_definition_/, '').replace(/_/g, ' ');

/** Bot Builder: blocks menu (left) · toolbar + workspace (centre) · Summary / Transactions / Journal (right) · Run bar. */
export default function BotBuilder() {
  const { site, xmlBots } = useTrader();
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const preview = account?.id === PREVIEW_ACCOUNT_ID;
  const key = `mw_bot_${site.subdomain}`;

  const savedCfg = (): BotConfig => { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return DEFAULT_CONFIG; } };
  // The bot is always blocks. Signals / Daily Plan write settings and clear the saved XML, so it is regenerated here.
  const [botXml, setBotXml] = useState<string>(() => localStorage.getItem(`${key}_xml`) || configToXml(savedCfg()));
  const [meta, setMeta] = useState<Meta>(() => {
    try { return JSON.parse(localStorage.getItem(`${key}_name`) ?? 'null') ?? { name: 'My bot', params: [], notes: [] }; } catch { return { name: 'My bot', params: [], notes: [] }; }
  });
  const latestXml = useRef(botXml);
  const editor = useRef<EditorApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [quick, setQuick] = useState(false);
  const [settings, setSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [params, setParams] = useSearchParams();

  const remember = (xml: string, m: Meta) => {
    latestXml.current = xml;
    try { localStorage.setItem(`${key}_xml`, xml); localStorage.setItem(`${key}_name`, JSON.stringify(m)); } catch { /* storage full */ }
  };
  const openBot = (xml: string, name: string) => {
    const b = parseDerivXml(xml, name);
    const m = { name: b.name, params: b.params, notes: b.notes };
    setMeta(m); setBotXml(xml); remember(xml, m);
    toast(`${b.name} loaded`);
  };
  const onBlocksChange = (xml: string) => {
    try { const b = parseDerivXml(xml, meta.name); const m = { name: meta.name, params: b.params, notes: b.notes }; setMeta(m); remember(xml, m); }
    catch { latestXml.current = xml; }
  };

  const importFile = async (f: File) => {
    setLoadError('');
    if (f.size > 2_000_000) return setLoadError('That file is too large for a bot file.');
    setBusy(true);
    try { openBot(await f.text(), f.name); } catch (e) { setLoadError((e as Error).message); } finally { setBusy(false); }
  };
  const loadFree = async (id: string) => {
    setLoadError(''); setBusy(true);
    try {
      const r = await fetch(`/api/xmlbots/download?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('Could not load that bot.');
      openBot(await r.text(), xmlBots.find((x) => x.id === id)?.name ?? 'Free bot');
    } catch (e) { setLoadError((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const id = params.get('bot');
    if (!id) return;
    setParams({}, { replace: true });
    void loadFree(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const xml = editor.current?.xml() ?? latestXml.current;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'text/xml' }));
    a.download = `${meta.name.replace(/[^\w -]+/g, '').trim() || 'bot'}.xml`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const resetBot = () => {
    if (!confirm('Start a new bot? Unsaved changes to this one will be lost.')) return;
    const xml = configToXml(DEFAULT_CONFIG);
    const m = { name: 'My bot', params: [], notes: [] };
    setMeta(m); setBotXml(xml); remember(xml, m);
  };
  const applyQuick = (c: BotConfig) => {
    localStorage.setItem(key, JSON.stringify(c));
    const xml = configToXml(c);
    const name = `${CONTRACTS.find((x) => x.id === c.contract)?.label ?? 'Quick'} bot`;
    const b = parseDerivXml(xml, name);
    const m = { name, params: b.params, notes: [] };
    setMeta(m); setBotXml(xml); remember(xml, m);
    setQuick(false); toast('Quick strategy built');
  };
  const setVar = (name: string, value: number) => {
    const next = setXmlVariable(latestXml.current, name, value);
    const b = parseDerivXml(next, meta.name);
    const m = { ...meta, params: b.params };
    setMeta(m); setBotXml(next); remember(next, m);
  };

  const bot = useBotEngine(account?.id, currency, auth.refreshBalance);
  const [panel, setPanel] = useState<Panel>('summary');
  const running = bot.state !== 'idle';
  const run = () => {
    if (account && !account.isVirtual && !confirm(`Run ${meta.name} on your REAL account? It trades exactly as built, using its own limits.`)) return;
    setPanel('journal');
    void bot.runXml(editor.current?.xml() ?? latestXml.current);
  };

  const q = search.trim().toLowerCase();
  const found = q ? MENU.flatMap((m) => m.blocks.filter((b) => pretty(b).includes(q) || m.name.toLowerCase().includes(q))) : [];
  useEffect(() => { if (q) editor.current?.showBlocks(found); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`bw ${menuOpen ? '' : 'menu-closed'}`}>
      <aside className="bw-menu">
        <button className="bw-quick" onClick={() => setQuick(true)} disabled={running}>⚡ Quick strategy</button>
        <div className="bw-menu-head">
          <b>Blocks menu</b>
          <button className="bw-icon" aria-label="Hide blocks menu" onClick={() => setMenuOpen(false)}>‹</button>
        </div>
        <label className="bw-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" placeholder="Search blocks" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search blocks" />
        </label>
        <nav className="bw-cats">
          {MENU.map((m) => (
            <button key={m.id} onClick={() => { setSearch(''); editor.current?.showBlocks(m.blocks); }} style={{ '--c': m.colour } as React.CSSProperties}>
              <i />{m.name}
            </button>
          ))}
        </nav>
        {q && found.length === 0 && <p className="hint" style={{ padding: '0 14px' }}>No blocks match “{search}”.</p>}
      </aside>

      <section className="bw-main">
        <div className="bw-toolbar" role="toolbar" aria-label="Bot tools">
          {!menuOpen && <button className="bw-tool" title="Show blocks menu" onClick={() => setMenuOpen(true)}>☰</button>}
          <button className="bw-tool" title="New bot" disabled={running} onClick={resetBot}>⟲</button>
          <button className="bw-tool" title="Import XML" disabled={running || busy} onClick={() => fileInput.current?.click()}>📂</button>
          <input ref={fileInput} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
          <button className="bw-tool" title="Save (download XML)" onClick={save}>💾</button>
          <span className="bw-sep" />
          <button className="bw-tool" title="Undo" disabled={running} onClick={() => editor.current?.ws.undo(false)}>↶</button>
          <button className="bw-tool" title="Redo" disabled={running} onClick={() => editor.current?.ws.undo(true)}>↷</button>
          <button className="bw-tool" title="Tidy blocks" disabled={running} onClick={() => editor.current?.ws.cleanUp()}>☷</button>
          <span className="bw-sep" />
          <button className="bw-tool" title="Zoom in" onClick={() => editor.current?.ws.zoomCenter(1)}>＋</button>
          <button className="bw-tool" title="Zoom out" onClick={() => editor.current?.ws.zoomCenter(-1)}>－</button>
          <button className="bw-tool" title="Centre" onClick={() => editor.current?.ws.scrollCenter()}>◎</button>
          <span className="bw-sep" />
          {xmlBots.length > 0 && (
            <select className="bw-free" aria-label="Free bots" disabled={running || busy} value="" onChange={(e) => e.target.value && void loadFree(e.target.value)}>
              <option value="">Free bots…</option>
              {xmlBots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <button className="bw-pill" disabled={running} onClick={() => setSettings(true)}>Bot settings</button>
          <span className="bw-name" title={meta.name}>{meta.name}</span>
        </div>
        {loadError && <p className="error bw-err">{loadError}</p>}
        <div className="bw-canvas">
          <Suspense fallback={<div className="bb-blocks-wait"><span className="spinner" /> Opening the workspace…</div>}>
            <BlockEditor xml={botXml} locked={running} onChange={onBlocksChange} onReady={(api) => { editor.current = api; }} />
          </Suspense>
        </div>
      </section>

      <aside className="bw-panel">
        <div className="bw-tabs" role="tablist" aria-label="Bot panel">
          {(['summary', 'transactions', 'journal'] as const).map((p) => <button key={p} role="tab" aria-selected={panel === p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
        </div>
        <div className="bw-body">
          {panel === 'summary' && (bot.summary.runs === 0
            ? <p className="bw-empty">When you're ready to trade, hit <b>Run</b>. You can follow your bot's results here.</p>
            : <div className="bw-chart-note">{bot.summary.won} won · {bot.summary.lost} lost</div>)}
          {panel === 'transactions' && (bot.trades.length === 0 ? <p className="bw-empty">No transactions yet. Trades appear here when the bot runs.</p> : (
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
          {panel === 'journal' && (bot.journal.length === 0 ? <p className="bw-empty">Every step the bot takes is logged here, including each executed trade.</p> : (
            <ul className="bb-list bb-journal">
              {bot.journal.map((j, i) => (
                <li key={i} className={`bb-j ${j.level}`}><small className="mono">{new Date(j.t).toLocaleTimeString()}</small><span>{j.text}</span></li>
              ))}
            </ul>
          ))}
        </div>
        <div className="bw-stats">
          <Stat k="Total stake" v={`${bot.summary.stake.toFixed(2)} ${currency}`} />
          <Stat k="Total payout" v={`${bot.summary.payout.toFixed(2)} ${currency}`} />
          <Stat k="No. of runs" v={String(bot.summary.runs)} />
          <Stat k="Contracts lost" v={String(bot.summary.lost)} tone={bot.summary.lost ? 'bad' : undefined} />
          <Stat k="Contracts won" v={String(bot.summary.won)} tone={bot.summary.won ? 'ok' : undefined} />
          <Stat k="Total profit/loss" v={`${bot.summary.pnl >= 0 ? '' : '-'}${Math.abs(bot.summary.pnl).toFixed(2)} ${currency}`} tone={bot.summary.pnl > 0 ? 'ok' : bot.summary.pnl < 0 ? 'bad' : undefined} />
        </div>
        <button className="bw-reset" disabled={running} onClick={bot.reset}>Reset results</button>
      </aside>

      <div className="bw-runbar">
        <span className={`bb-status ${running ? 'on' : ''}`}><span className="bb-pulse" />{bot.state === 'running' ? 'Bot running' : bot.state === 'stopping' ? 'Stopping…' : 'Bot is not running'}</span>
        {preview && <span className="hint">Clients run bots here after logging in.</span>}
        {running
          ? <button className="bw-run stop" disabled={bot.state === 'stopping'} onClick={bot.stop}>■ Stop</button>
          : <button className="bw-run" disabled={preview} onClick={run}>▶ Run</button>}
      </div>

      {quick && <QuickStrategy initial={savedCfg()} currency={currency} onClose={() => setQuick(false)} onApply={applyQuick} />}
      {settings && (
        <div className="cx-wrap" role="dialog" aria-modal="true" aria-label="Bot settings" onClick={() => setSettings(false)}>
          <div className="cx" onClick={(e) => e.stopPropagation()}>
            <header className="cx-head"><h2>Bot settings</h2><span className="cx-acct">{meta.name}</span><button className="cx-x" aria-label="Close" onClick={() => setSettings(false)}>✕</button></header>
            <div className="cx-body">
              {meta.params.length === 0 ? <p className="hint">This bot has no start-up numbers. Edit it in the workspace.</p> : (
                <div className="bb-row">{meta.params.map((p) => <Field key={p.name} id={`bs-${p.name}`} label={p.name} value={p.value} onChange={(v) => { if (v !== '' && Number.isFinite(Number(v))) setVar(p.name, Number(v)); }} />)}</div>
              )}
              {meta.notes.map((n) => <p key={n} className="hint">• {n}</p>)}
              <p className="hint">These are the values the bot starts with. Everything else runs exactly as built.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Quick strategy: four short steps that build a complete block bot. */
function QuickStrategy({ initial, currency, onClose, onApply }: { initial: BotConfig; currency: string; onClose: () => void; onApply: (c: BotConfig) => void }) {
  const [cfg, setCfg] = useState<BotConfig>(initial);
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const isDigit = CONTRACTS.find((c) => c.id === cfg.contract)?.digit ?? false;
  const addMode = cfg.recoveryMode === 'add';
  const problems: string[] = [];
  if (!(cfg.stake >= 0.35)) problems.push('Stake must be at least 0.35');
  if (cfg.contract === 'DIGITOVER' && cfg.prediction > 8) problems.push('Over needs a digit from 0 to 8');
  if (cfg.contract === 'DIGITUNDER' && cfg.prediction < 1) problems.push('Under needs a digit from 1 to 9');
  if (!(cfg.stopLoss > 0)) problems.push('Set a stop loss');
  if (cfg.recovery && !(cfg.multiplier > 0 && cfg.multiplier <= 5)) problems.push('Recovery factor must be above 0 and at most 5');
  return (
    <div className="cx-wrap" role="dialog" aria-modal="true" aria-label="Quick strategy" onClick={onClose}>
      <div className="cx qs" onClick={(e) => e.stopPropagation()}>
        <header className="cx-head"><h2>⚡ Quick strategy</h2><span className="cx-acct">Builds the blocks for you</span><button className="cx-x" aria-label="Close" onClick={onClose}>✕</button></header>
        <div className="cx-body">
          <section className="qs-step"><header><span>1</span><b>Market & contract</b></header>
            <select className="input" value={cfg.symbol} onChange={(e) => set('symbol', e.target.value)} aria-label="Market">
              {SYMBOLS.filter((s) => /^(1HZ|R_)/.test(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="seg bb-seg">{CONTRACTS.map((c) => <button key={c.id} className={cfg.contract === c.id ? 'on' : ''} onClick={() => set('contract', c.id)}>{c.label}</button>)}</div>
            {isDigit && <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} className={cfg.prediction === d ? 'on' : ''} onClick={() => set('prediction', d)}>{d}</button>)}</div>}
            <label className="label">Duration: {cfg.ticks} tick{cfg.ticks === 1 ? '' : 's'} <InfoTip>{TIPS.duration}</InfoTip></label>
            <input type="range" min={1} max={10} value={cfg.ticks} onChange={(e) => set('ticks', Number(e.target.value))} aria-label="Ticks" />
          </section>
          <section className="qs-step"><header><span>2</span><b>Entry</b></header>
            <label className="bb-check"><input type="checkbox" checked={cfg.entryDigit === null} onChange={(e) => set('entryDigit', e.target.checked ? null : 5)} /> Buy straight away</label>
            {cfg.entryDigit !== null && <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} className={cfg.entryDigit === d ? 'on' : ''} onClick={() => set('entryDigit', d)}>{d}</button>)}</div>}
          </section>
          <section className="qs-step"><header><span>3</span><b>Stake & recovery</b></header>
            <Field id="qs-stake" label="Initial stake" tip={TIPS.stake} value={cfg.stake} suffix={currency} onChange={(v) => set('stake', num(v))} />
            <label className="bb-check"><input type="checkbox" checked={cfg.recovery} onChange={(e) => set('recovery', e.target.checked)} /> Raise the stake after a loss</label>
            {cfg.recovery && (
              <>
                <div className="seg"><button className={!addMode ? 'on' : ''} onClick={() => setCfg((c) => ({ ...c, recoveryMode: 'multiply', multiplier: c.multiplier > 1 ? c.multiplier : 2 }))}>Martingale</button><button className={addMode ? 'on' : ''} onClick={() => set('recoveryMode', 'add')}>Add the loss</button></div>
                <div className="bb-row">
                  <Field id="qs-mult" label={addMode ? 'Next stake + loss ×' : 'Multiply by'} value={cfg.multiplier} suffix="×" onChange={(v) => set('multiplier', num(v, 2))} />
                  <Field id="qs-max" label="Max stake" value={cfg.maxStake} suffix={currency} onChange={(v) => set('maxStake', num(v))} />
                </div>
              </>
            )}
          </section>
          <section className="qs-step"><header><span>4</span><b>Limits</b></header>
            <div className="bb-row">
              <Field id="qs-tp" label="Take profit" tip={TIPS.takeProfit} value={cfg.takeProfit} suffix={currency} onChange={(v) => set('takeProfit', num(v))} />
              <Field id="qs-sl" label="Stop loss" tip={TIPS.stopLoss} value={cfg.stopLoss} suffix={currency} onChange={(v) => set('stopLoss', num(v))} />
            </div>
          </section>
          {problems[0] && <p className="error">{problems[0]}</p>}
        </div>
        <footer className="cx-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="cx-primary" style={{ flex: 1, maxWidth: 260 }} disabled={problems.length > 0} onClick={() => onApply(cfg)}>Build my bot</button></footer>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, suffix, tip }: { id: string; label: string; value: number; onChange: (v: string) => void; suffix?: string; tip?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="field" style={{ flex: 1, minWidth: 130 }}>
      <label className="label" htmlFor={id}>{label}{tip && <InfoTip>{tip}</InfoTip>}</label>
      <div className="input-group">
        <input id={id} className="input mono" inputMode="decimal" value={text} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setText(v); onChange(v); }} />
        {suffix && <span className="addon">{suffix}</span>}
      </div>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  return <div className="bw-stat"><small>{k}</small><b className="mono" style={{ color: tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{v}</b></div>;
}
