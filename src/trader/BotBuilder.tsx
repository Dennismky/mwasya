import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from '../components/motion';
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { configToXml } from './blocks';
import type { EditorApi } from './BlockEditor';
import { DEFAULT_CONFIG, type BotConfig } from './botEngine';
import { useTrader } from './TraderApp';
import { parseDerivXml, setXmlSymbol, setXmlVariable, xmlSymbol, type LoadedBot } from './xmlBot';
import { BOT_MARKETS, isBotMarket, marketOfSymbol, useMarket } from './market';
import { fetchBotXml, preloadEditor } from './botFiles';
import { CONTRACTS, Field, StrategyFields, strategyProblems } from './StrategyForm';

const BlockEditor = lazy(() => preloadEditor() as Promise<typeof import('./BlockEditor')>);
/** The bot always trades the site-wide market (the one the client analyses), when it is a Volatility index. */
const onMarket = (xml: string, market: string) => (isBotMarket(market) ? setXmlSymbol(xml, market, marketOfSymbol(market)) : xml);

type Meta = Pick<LoadedBot, 'name' | 'params' | 'notes'>;

/** Bot Builder: blocks menu (left) · toolbar + workspace (centre) · Summary / Transactions / Journal (right) · Run bar. */
export default function BotBuilder() {
  const { site, xmlBots, bot, autoStop, setAutoStop } = useTrader();
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const preview = account?.id === PREVIEW_ACCOUNT_ID;
  const key = `mw_bot_${site.subdomain}`;

  const [market, setMarket] = useMarket();
  const savedCfg = (): BotConfig => { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(key) ?? '{}') }; } catch { return DEFAULT_CONFIG; } };
  // The bot is always blocks. Signals / Daily Plan write settings and clear the saved XML, so it is regenerated here.
  const [botXml, setBotXml] = useState<string>(() => onMarket(localStorage.getItem(`${key}_xml`) || configToXml(savedCfg()), market));
  const [savedAt, setSavedAt] = useState(0);
  // Opening a free bot from the Free Bots page: show "Opening…" instead of the previous bot until it arrives.
  const [loadingName, setLoadingName] = useState(() => (new URLSearchParams(window.location.search).get('bot') ? 'free bot' : ''));
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
  const [params, setParams] = useSearchParams();

  const remember = (xml: string, m: Meta) => {
    latestXml.current = xml;
    try { localStorage.setItem(`${key}_xml`, xml); localStorage.setItem(`${key}_name`, JSON.stringify(m)); setSavedAt(Date.now()); } catch { /* storage full */ }
  };
  const openBot = (raw: string, name: string) => {
    const b = parseDerivXml(raw, name);
    const own = xmlSymbol(raw);
    const xml = onMarket(raw, market);
    const m = { name: b.name, params: b.params, notes: b.notes };
    setMeta(m); setBotXml(xml); remember(xml, m);
    const moved = own && own !== xmlSymbol(xml);
    toast(moved ? `${b.name} loaded · set to ${BOT_MARKETS.find((x) => x.id === market)?.name ?? market}` : `${b.name} loaded`);
  };
  const onBlocksChange = (xml: string) => {
    // Changing the market inside the blocks changes it for the whole site (D-Circles, Charts, Quick Bot follow).
    const sym = xmlSymbol(xml);
    if (sym && sym !== market && isBotMarket(sym)) setMarket(sym);
    try { const b = parseDerivXml(xml, meta.name); const m = { name: meta.name, params: b.params, notes: b.notes }; setMeta(m); remember(xml, m); }
    catch { latestXml.current = xml; try { localStorage.setItem(`${key}_xml`, xml); setSavedAt(Date.now()); } catch { /* storage full */ } }
  };
  // The client picked another market (here, D-Circles, Charts, Signals…): move the bot onto it.
  useEffect(() => {
    if (!isBotMarket(market) || xmlSymbol(latestXml.current) === market) return;
    if (editor.current) editor.current.setMarket(market);
    else { const next = onMarket(latestXml.current, market); setBotXml(next); remember(next, meta); }
  }, [market]); // eslint-disable-line react-hooks/exhaustive-deps

  const importFile = async (f: File) => {
    setLoadError('');
    if (f.size > 2_000_000) return setLoadError('That file is too large for a bot file.');
    setBusy(true);
    try { openBot(await f.text(), f.name); } catch (e) { setLoadError((e as Error).message); } finally { setBusy(false); }
  };
  const loadFree = async (id: string) => {
    const name = xmlBots.find((x) => x.id === id)?.name ?? 'Free bot';
    setLoadError(''); setBusy(true); setLoadingName(name);
    try { openBot(await fetchBotXml(id), name); } catch (e) { setLoadError((e as Error).message); } finally { setBusy(false); setLoadingName(''); }
  };
  useEffect(() => {
    // ?quick=1 (Daily Plan's "Use this plan in Bot Builder"): open Quick strategy filled with the saved plan.
    if (params.get('quick')) { setParams({}, { replace: true }); setQuick(true); return; }
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
    remember(xml, meta);
    toast(`Saved · ${a.download} is in your Downloads`);
  };
  const resetBot = () => {
    if (!confirm('Start a new bot? Unsaved changes to this one will be lost.')) return;
    const xml = onMarket(configToXml(DEFAULT_CONFIG), market);
    const m = { name: 'My bot', params: [], notes: [] };
    setMeta(m); setBotXml(xml); remember(xml, m);
  };
  const applyQuick = (c: BotConfig) => {
    localStorage.setItem(key, JSON.stringify(c));
    setMarket(c.symbol);
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

  const running = bot.state !== 'idle';
  const run = () => {
    let xml = editor.current?.xml() ?? latestXml.current;
    // Last check: the bot trades the market the client is looking at.
    if (isBotMarket(market) && xmlSymbol(xml) && xmlSymbol(xml) !== market) { editor.current?.setMarket(market); xml = onMarket(xml, market); }
    const where = BOT_MARKETS.find((x) => x.id === xmlSymbol(xml))?.name ?? xmlSymbol(xml);
    if (account && !account.isVirtual && !confirm(`Run ${meta.name} on your REAL account?\n\nMarket: ${where}\nIt trades exactly as built, using its own limits.`)) return;
    void bot.runXml(xml);
  };


  return (
    <div className="bw bw-full">
      <section className="bw-main">
        <div className="bw-toolbar" role="toolbar" aria-label="Bot tools">
          <button className="bw-quick" onClick={() => setQuick(true)} disabled={running}>⚡ Quick strategy</button>
          <span className="bw-sep" />
          <button className="bw-tool" title="New bot" disabled={running} onClick={resetBot}>⟲</button>
          <button className="bw-tool" title="Import XML" disabled={running || busy} onClick={() => fileInput.current?.click()}>📂</button>
          <input ref={fileInput} type="file" accept=".xml,text/xml,application/xml" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
          <button className="bw-tool bw-save" title="Save a copy to your device (.xml)" onClick={save}>💾<span>Save</span></button>
          <span className="bw-sep" />
          <button className="bw-tool" title="Undo" disabled={running} onClick={() => editor.current?.ws.undo(false)}>↶</button>
          <button className="bw-tool" title="Redo" disabled={running} onClick={() => editor.current?.ws.undo(true)}>↷</button>
          <button className="bw-tool" title="Tidy blocks" disabled={running} onClick={() => editor.current?.tidy()}>☷</button>
          <span className="bw-sep" />
          <button className="bw-tool" title="Zoom in" onClick={() => editor.current?.ws.zoomCenter(1)}>＋</button>
          <button className="bw-tool" title="Zoom out" onClick={() => editor.current?.ws.zoomCenter(-1)}>－</button>
          <button className="bw-tool" title="Fit bot to screen" onClick={() => { const w = editor.current?.ws; if (w) { w.zoomToFit(); if (w.getScale() > 0.95) w.setScale(0.95); w.scrollCenter(); } }}>⤢</button>
          <button className="bw-tool" title="Back to the start (Trade parameters)" onClick={() => editor.current?.home()}>⌂</button>
          <button className="bw-tool" title="Centre" onClick={() => editor.current?.ws.scrollCenter()}>◎</button>
          <span className="bw-sep" />
          {xmlBots.length > 0 && (
            <select className="bw-free" aria-label="Free bots" disabled={running || busy} value="" onChange={(e) => e.target.value && void loadFree(e.target.value)}>
              <option value="">Free bots…</option>
              {xmlBots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          {/* EDIT HERE: the market this bot trades. It is the same market as D-Circles, Charts and Quick Bot. */}
          <label className="bw-market" title="The market this bot trades (same as D-Circles and Charts)">
            <span>Market</span>
            <select aria-label="Market" disabled={running} value={isBotMarket(market) ? market : xmlSymbol(botXml)} onChange={(e) => setMarket(e.target.value)}>
              {BOT_MARKETS.map((m) => <option key={m.id} value={m.id}>{m.name.replace(' Index', '')}</option>)}
            </select>
          </label>
          <button className="bw-pill" disabled={running} onClick={() => setSettings(true)}>Bot settings</button>
          <span className="bw-name" title={meta.name}>{meta.name}</span>
          <span className={`bw-saved ${savedAt ? 'on' : ''}`} aria-live="polite">{savedAt ? '✓ Saved' : ''}</span>
        </div>
        {loadError && <p className="error bw-err">{loadError}</p>}
        <div className="bw-canvas">
          <Suspense fallback={<div className="bb-blocks-wait"><span className="spinner" /> Opening the workspace…</div>}>
            {!loadingName && <BlockEditor xml={botXml} locked={running} onChange={onBlocksChange} onReady={(api) => { editor.current = api; if (api && isBotMarket(market) && xmlSymbol(latestXml.current) !== market) api.setMarket(market); }} />}
          </Suspense>
          {loadingName && <div className="bb-blocks-wait"><span className="spinner" /> Opening {loadingName}…</div>}
        </div>
      </section>

      <div className="bw-runbar">
        <span className={`bb-status ${running ? 'on' : ''}`}><span className="bb-pulse" />{bot.state === 'running' ? 'Bot running' : bot.state === 'stopping' ? 'Stopping…' : 'Bot is not running'}</span>
        {preview && <span className="hint">Clients run bots here after logging in.</span>}
        <label className="bw-autostop" title="Stops after the open trade when you switch browser tab, minimise, lock your phone, or leave Bot Builder.">
          <input type="checkbox" checked={autoStop} onChange={(e) => setAutoStop(e.target.checked)} />
          <span className="bw-switch" aria-hidden="true" />Stop when I leave
        </label>
        {running
          ? <button className="bw-run stop" disabled={bot.state === 'stopping'} onClick={bot.stop}>■ Stop</button>
          : <button className="bw-run" disabled={preview} onClick={run}>▶ Run</button>}
      </div>

      {quick && <QuickStrategy initial={{ ...savedCfg(), ...(isBotMarket(market) ? { symbol: market } : {}) }} currency={currency} onClose={() => setQuick(false)} onApply={applyQuick} />}
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
  const problems = strategyProblems(cfg);
  return (
    <div className="cx-wrap" role="dialog" aria-modal="true" aria-label="Quick strategy" onClick={onClose}>
      <div className="cx qs" onClick={(e) => e.stopPropagation()}>
        <header className="cx-head"><h2>⚡ Quick strategy</h2><span className="cx-acct">Builds the blocks for you</span><button className="cx-x" aria-label="Close" onClick={onClose}>✕</button></header>
        <div className="cx-body">
          <StrategyFields cfg={cfg} setCfg={setCfg} currency={currency} />
          {problems[0] && <p className="error">{problems[0]}</p>}
        </div>
        <footer className="cx-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="cx-primary" style={{ flex: 1, maxWidth: 260 }} disabled={problems.length > 0} onClick={() => onApply(cfg)}>Build my bot</button></footer>
      </div>
    </div>
  );
}
