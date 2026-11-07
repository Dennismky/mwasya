import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useOutletContext, Outlet } from 'react-router-dom';
import { Icon } from '../components/ui';
import { ToTop } from '../components/motion';
import { AccountSwitcher } from './AccountSwitcher';
import { Cashier } from './Cashier';
import { Bell } from './Bell';
import { Floating } from '../components/Floating';
import { RunPanel } from './RunPanel';
import { PageBoundary } from '../components/PageBoundary';
import { useBotEngine } from './botEngine';
import { AuthProvider, PreviewAuthProvider, useAuth } from '../lib/auth';
import { reloadTenant, type Announcement, type PublishedBot, type SiteBranding, type SiteVideo } from '../lib/tenant';
import { useBotRunner } from '../lib/useBotRunner';
import { runPnL } from '../lib/autoTrade';
import Analysis from './Analysis';
import Signals from './Signals';
import Tutorials from './Tutorials';
const Charts = lazy(() => import('./Charts'));
import FreeBots from './FreeBots';
import ManualTrader from './ManualTrader';
import QuickBot from './QuickBot';
import RiskCalculator from './RiskCalculator';
import TraderDashboard from './TraderDashboard';
import BotBuilder from './BotBuilder';
import Reports from './Reports';
import { Ticker } from './Ticker';
import { Loader } from '../components/Loader';
import { preloadEditor, whenIdle } from './botFiles';

export interface XmlBotLite { id: string; name: string; description: string }
export interface TraderCtx {
  site: SiteBranding;
  bots: PublishedBot[];
  xmlBots: XmlBotLite[];
  /** The mentor's tutorial videos (YouTube). */
  videos: SiteVideo[];
  runner: ReturnType<typeof useBotRunner>;
  /** The bot engine lives here so a bot keeps running on every page, and every tool logs to one Journal. */
  bot: ReturnType<typeof useBotEngine>;
  /** Light or dark, as the client chose (starts from the mentor's theme). */
  dark: boolean;
  /** Stop the bot (after its open trade) when the client leaves Bot Builder or the browser tab. */
  autoStop: boolean;
  setAutoStop: (on: boolean) => void;
  /** Where the trading site is mounted: '/app' on a live site, '/preview/<id>' in the studio preview. */
  base: string;
  preview: boolean;
}
export const useTrader = () => useOutletContext<TraderCtx>();

/** `short` = label in the phone bottom bar; `primary` tabs sit in that bar, the rest go under "More". */
// EDIT HERE: client site tabs (order, names, icons). 'feature' must match an id in src/shared/templates.ts SITE_FEATURES.
const TABS: { to: string; label: string; short: string; icon: ReactNode; end?: boolean; feature?: string; primary?: boolean }[] = [
  { to: '', label: 'Dashboard', short: 'Home', icon: <Icon.Chart />, end: true, primary: true },
  { to: '/bot-builder', label: 'Bot Builder', short: 'Builder', icon: <Icon.Gear />, feature: 'bots' },
  { to: '/quick-bot', label: 'Quick Bot', short: 'Bots', icon: <Icon.Chip />, feature: 'bots', primary: true },
  { to: '/manual', label: 'Manual Trader', short: 'Trade', icon: <Icon.Window />, feature: 'manual', primary: true },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: <Icon.Card />, primary: true },
  { to: '/free-bots', label: 'Free Bots', short: 'Free Bots', icon: <Icon.Code />, feature: 'freebots' },
  { to: '/charts', label: 'Charts', short: 'Charts', icon: <Icon.Chart />, feature: 'charts' },
  { to: '/signals', label: 'Signals', short: 'Signals', icon: <Icon.Chip />, feature: 'analysis' },
  { to: '/analysis', label: 'D-Circles', short: 'D-Circles', icon: <Icon.Help />, feature: 'analysis' },
  { to: '/risk', label: 'Daily Plan', short: 'Plan', icon: <Icon.Gear />, feature: 'risk' },
  { to: '/tutorials', label: 'Tutorials', short: 'Learn', icon: <Icon.Help />, feature: 'learn' },
];

/** `/app/*` on <brand>.mwasya.site — the client trading platform. */
export default function TraderApp({ site, bots, xmlBots, base = '/app', preview = false }: { site: SiteBranding; bots: PublishedBot[]; xmlBots: XmlBotLite[]; base?: string; preview?: boolean }) {
  const Provider = preview ? PreviewAuthProvider : AuthProvider;
  return (
    <Provider>
      <Routes>
        <Route element={<Shell site={site} initialBots={bots} initialXml={xmlBots} base={base} preview={preview} />}>
          <Route index element={<TraderDashboard />} />
          <Route path="bot-builder" element={<BotBuilder />} />
          <Route path="free-bots" element={<FreeBots />} />
          <Route path="quick-bot" element={<QuickBot />} />
          <Route path="manual" element={<ManualTrader />} />
          <Route path="charts" element={<Suspense fallback={<div className="ch-loading" style={{ position: "static", height: 300 }}><span className="spinner" /> Loading chart…</div>}><Charts /></Suspense>} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="signals" element={<Signals />} />
          <Route path="tutorials" element={<Tutorials />} />
          <Route path="risk" element={<RiskCalculator />} />
          <Route path="reports" element={<Reports />} />
          <Route path="*" element={<Navigate to={base} replace />} />
        </Route>
      </Routes>
    </Provider>
  );
}

function Shell({ site, initialBots, initialXml, base, preview }: { site: SiteBranding; initialBots: PublishedBot[]; initialXml: XmlBotLite[]; base: string; preview: boolean }) {
  const auth = useAuth();
  const [bots, setBots] = useState(initialBots);
  const [xmlBots, setXmlBots] = useState(initialXml);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [videos, setVideos] = useState<SiteVideo[]>([]);
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const [disclaimer, setDisclaimer] = useState(false);
  const [cashier, setCashier] = useState(() => new URLSearchParams(window.location.search).get('cashier') === '1');
  useEffect(() => { if (cashier && window.location.search.includes('cashier=1')) window.history.replaceState(null, '', window.location.pathname); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [notice, setNotice] = useState('');
  const location = useLocation();
  useEffect(() => { setMore(false); setMenu(false); }, [location.pathname]);

  const resetDemo = async () => {
    setMenu(false);
    if (!auth.account?.isVirtual || preview) return;
    const r = await fetch('/api/deriv/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ action: 'reset_demo', accountId: auth.account.id }) });
    setNotice(r.ok ? 'Demo balance reset.' : r.status === 429 ? 'Too many resets. Try again later.' : 'Could not reset the demo balance.');
    if (r.ok) auth.refreshBalance();
    setTimeout(() => setNotice(''), 4000);
  };
  // Speed: once the site has opened, fetch Bot Builder and the chart in the background so those pages open at once.
  useEffect(() => { whenIdle(() => { void preloadEditor(); void import('./Charts'); }); }, []);
  const runner = useBotRunner(auth.account?.id, auth.expire, auth.refreshBalance);
  const bot = useBotEngine(auth.account?.id, auth.account?.currency ?? 'USD', auth.refreshBalance);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem('mw_panel') !== '0');
  const togglePanel = (o: boolean) => { setPanelOpen(o); localStorage.setItem('mw_panel', o ? '1' : '0'); };
  // Daily Plan does not trade, and Manual Trader has its own trade panel on the right (like a trading terminal), so the results panel stays out of the way there.
  const noPanel = /\/(manual|reports|risk)$/.test(location.pathname);
  const showPanel = panelOpen && !noPanel;
  const [autoStop, setAutoStopState] = useState(() => localStorage.getItem('mw_autostop') !== '0');
  const setAutoStop = (on: boolean) => { setAutoStopState(on); localStorage.setItem('mw_autostop', on ? '1' : '0'); };
  const botRef = useRef(bot);
  botRef.current = bot;
  // Security: stop when the browser tab is hidden (another tab, minimised, phone locked)…
  useEffect(() => {
    if (!autoStop) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden' && botRef.current.state === 'running') {
        botRef.current.log('info', 'You left this page, so the bot is stopping after its open trade.');
        botRef.current.stop();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [autoStop]);
  // …and when the client leaves the bot pages (Bot Builder / Quick Bot) for another tool.
  useEffect(() => {
    if (autoStop && !/\/(bot-builder|quick-bot)$/.test(location.pathname) && botRef.current.state === 'running') {
      botRef.current.log('info', 'You left the bot pages, so the bot is stopping after its open trade.');
      botRef.current.stop();
    }
  }, [location.pathname, autoStop]);
  const modeKey = `mw_mode_${site.subdomain}`;
  const [mode, setMode] = useState<'dark' | 'light'>(() => (localStorage.getItem(modeKey) === 'dark' || localStorage.getItem(modeKey) === 'light' ? localStorage.getItem(modeKey) as 'dark' | 'light' : site.theme === 'dark' ? 'dark' : 'light'));
  const toggleMode = () => setMode((m) => { const n = m === 'dark' ? 'light' : 'dark'; localStorage.setItem(modeKey, n); return n; });
  const dark = mode === 'dark';
  // Older sites have no feature list yet: show everything.
  const has = (f?: string) => !f || !site.features?.length || site.features.includes(f);
  const tabs = TABS.filter((t) => has(t.feature));

  // Preview: the mentor sees their own announcements under the bell.
  useEffect(() => {
    if (!preview) return;
    const id = base.split('/').pop();
    fetch(`/api/sites/${id}/announcements`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { announcements: [] })).then((j) => setAnnouncements(j.announcements ?? [])).catch(() => undefined);
    fetch(`/api/sites/${id}/videos`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { videos: [] })).then((j) => setVideos(j.videos ?? [])).catch(() => undefined);
  }, [preview, base]);
  useEffect(() => {
    if (preview) return; // the studio already passed this site's bots
    const load = () => reloadTenant().then((t) => {
      if (t.kind === 'site') { setBots(t.bots); setXmlBots(t.xmlBots ?? []); setAnnouncements(t.announcements ?? []); setVideos(t.videos ?? []); }
      // The owner was suspended while clients had the site open: reload, and the site only shows its loading screen.
      if (t.kind === 'held') window.location.reload();
    }).catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [preview]);

  if (auth.status === 'signed-out') return <Navigate to="/" replace state={{ from: '/app', error: auth.error }} />;
  if (auth.status === 'checking') return <Loader label={`Opening ${site.name}`} mark={site.name.slice(0, 2).toUpperCase()} />;

  const account = auth.account;
  const live = Object.values(runner.runs).filter((r) => r.status !== 'stopped');
  const livePnl = live.reduce((s, r) => s + runPnL(r), 0);
  const style = { '--primary': site.accent, '--primary-hover': site.accent, '--accent': site.accent } as CSSProperties;

  return (
    <div className={`tp tpl-${site.template ?? 'bothub'} tp-l-${site.layout ?? 'classic'} ${dark ? 'tp-dark' : ''}`} style={style} data-theme={dark ? 'dark' : undefined}>
      <header className="tp-head">
        <button className="tp-burger" aria-label="Menu" aria-expanded={more} onClick={() => setMore((m) => !m)}>☰</button>
        {site.logoUrl ? <img className="brand-mark" src={site.logoUrl} alt="" style={{ objectFit: "cover" }} /> : <span className="brand-mark" style={{ background: site.accent }}>{site.name.charAt(0).toUpperCase()}</span>}
        <div className="stack" style={{ lineHeight: 1.1 }}>
          <b style={{ fontSize: 16 }}>{site.name}</b>
          <span className="hint" style={{ fontSize: 10, letterSpacing: '.08em' }}>{site.subdomain.toUpperCase()}</span>
        </div>
        <span style={{ flex: 1 }} />
        {has("deposit") && <button className="btn tp-deposit tp-cashier" onClick={() => setCashier(true)}>Cashier</button>}
        <button className={`tp-switch ${dark ? 'on' : ''}`} role="switch" aria-checked={dark} onClick={toggleMode} aria-label="Dark mode" title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
          <span className="tp-switch-sky" aria-hidden="true"><i /><i /><i /></span>
          <span className="tp-switch-knob" aria-hidden="true"><i /><i /></span>
        </button>
        <AccountSwitcher preview={preview} onResetDemo={resetDemo} />
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost tp-user" aria-label="Account menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon.Users />
          </button>
          {menu && (
            <div className="tp-menu" role="menu">
              <span className="hint mono" style={{ padding: '6px 10px' }}>{account?.id}</span>
              {account?.isVirtual && !preview && <button role="menuitem" onClick={resetDemo}><Icon.Coin /> Reset demo balance</button>}
              <button role="menuitem" onClick={() => { setMenu(false); setDisclaimer(true); }}><Icon.Shield /> Risk disclaimer</button>
              <button role="menuitem" onClick={auth.signOut}><Icon.Logout /> Log out</button>
            </div>
          )}
        </div>
      </header>

      {/* Laptop/tablet: every tab fits the width, no sideways scrolling. Phones use the bottom bar instead. */}
      <nav className="tp-nav" aria-label="Trading tools">
        {tabs.map((t) => (
          <NavLink key={t.to} to={base + t.to} end={t.end} className={({ isActive }) => `tp-tab ${isActive ? 'active' : ''}`} title={t.label}>
            {t.icon}<span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
      {has("charts") && <Ticker />}

      <main className={`tp-main tp-fit ${showPanel ? 'with-panel' : ''}`}>
        <div className="tp-page">
        {notice && <div className="tp-preview" role="status">{notice}</div>}
        {preview && <div className="tp-preview"><b>Client preview.</b> This is exactly what your clients see. Prices and charts are live; trading is off until a client logs in on your deployed site.</div>}
        {account && !account.isVirtual && (
          <div className="tp-real">You're on your <b>real</b> account. Switch to Demo in the top bar to practise.</div>
        )}
          <PageBoundary resetKey={location.pathname}><Outlet context={{ site, bots, xmlBots, videos, runner, bot, dark, autoStop, setAutoStop, base, preview } satisfies TraderCtx} /></PageBoundary>
        </div>
        {noPanel ? null : panelOpen
          ? <RunPanel bot={bot} currency={auth.account?.currency ?? 'USD'} onCollapse={() => togglePanel(false)} />
          : <>
              <button className="rp-open" aria-label="Show results panel" title="Results" onClick={() => togglePanel(true)}>«<span>Results</span></button>
              {/* EDIT HERE: phones: the minimised results card. Green when stopped, red with live profit/loss while a bot runs. */}
              <Floating id="results" start={{ right: 12, bottom: 96 }} onTap={() => togglePanel(true)} label={bot.state === 'idle' ? 'Open results. Bot stopped' : 'Open results. Bot running'} className={`fl-results ${bot.state === 'idle' ? 'stopped' : 'running'}`}>
                <span className="fl-res-dot" aria-hidden="true" />
                <span className="mono">{bot.state === 'idle' ? 'Results' : `${bot.summary.pnl >= 0 ? '+' : '-'}${Math.abs(bot.summary.pnl).toFixed(2)}`}</span>
              </Floating>
            </>}
      </main>
      <ToTop target=".tp-page" />

      <footer className="tp-foot">
        <span className="tp-status">
          {live.length > 0
            ? <><span className="dot dot-real pulse" /> {live.length} bot{live.length > 1 ? 's' : ''} running · <b className="mono" style={{ color: livePnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}</b></>
            : preview ? <><span className="dot dot-demo" /> Preview</> : <><span className={`dot ${runner.conn === 'ready' ? 'dot-real' : 'dot-demo'}`} /> {runner.conn === 'ready' ? 'Connected' : 'Connecting…'}</>}
        </span>
        <Clock />
      </footer>

      {/* Phones: ☰ opens this drawer from the left with every tool and account action. */}
      {more && <button className="tp-scrim" aria-label="Close menu" onClick={() => setMore(false)} />}
      <aside className={`tp-drawer ${more ? 'open' : ''}`} aria-label="Menu" aria-hidden={!more}>
        <div className="tp-drawer-head">
          {site.logoUrl ? <img className="brand-mark" src={site.logoUrl} alt="" style={{ objectFit: 'cover' }} /> : <span className="brand-mark" style={{ background: site.accent }}>{site.name.charAt(0).toUpperCase()}</span>}
          <b>{site.name}</b>
          <button className="tp-drawer-x" aria-label="Close menu" onClick={() => setMore(false)}>✕</button>
        </div>
        <nav className="tp-drawer-nav">
          {tabs.map((t) => (
            <NavLink key={t.to} to={base + t.to} end={t.end} tabIndex={more ? 0 : -1} className={({ isActive }) => `tp-drawer-link ${isActive ? 'on' : ''}`} onClick={() => setMore(false)}>{t.icon}<span>{t.label}</span></NavLink>
          ))}
        </nav>
        <div className="tp-drawer-foot">
          {has('deposit') && (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn tp-deposit" style={{ flex: 1 }} tabIndex={more ? 0 : -1} onClick={() => { setMore(false); setCashier(true); }}>Deposit</button>
              <button className="btn tp-withdraw" style={{ flex: 1 }} tabIndex={more ? 0 : -1} onClick={() => { setMore(false); setCashier(true); }}>Withdraw</button>
            </div>
          )}
          <span className="tp-status" style={{ justifyContent: 'flex-start' }}>
            {live.length > 0
              ? <><span className="dot dot-real pulse" /> {live.length} bot{live.length > 1 ? 's' : ''} running · <b className="mono" style={{ color: livePnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}</b></>
              : <><span className={`dot ${runner.conn === 'ready' || preview ? 'dot-real' : 'dot-demo'}`} /> {preview ? 'Preview' : runner.conn === 'ready' ? 'Connected' : 'Connecting…'}</>}
          </span>
          <button className="tp-drawer-link" tabIndex={more ? 0 : -1} onClick={() => { setMore(false); setDisclaimer(true); }}><Icon.Shield /><span>Risk disclaimer</span></button>
          {!preview && <button className="tp-drawer-link" tabIndex={more ? 0 : -1} onClick={auth.signOut}><Icon.Logout /><span>Log out</span></button>}
        </div>
      </aside>

      <Bell items={announcements} siteKey={site.subdomain} siteName={site.name} />
      <Floating id="risk" start={{ left: 18, bottom: 52 }} onTap={() => setDisclaimer(true)} label="Risk disclaimer" className="fl-risk"><span aria-hidden="true" className="fl-risk-i">!</span><span className="fl-risk-t">Risk disclaimer</span></Floating>
      {cashier && <Cashier preview={preview} onClose={() => setCashier(false)} />}
      {disclaimer && (
        <div className="tp-modal" role="dialog" aria-modal="true" aria-labelledby="rd-title" onClick={() => setDisclaimer(false)}>
          <div className="card stack" style={{ gap: 12, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 id="rd-title" style={{ fontSize: 20, fontWeight: 700 }}>Risk Disclaimer</h2>
            {/* EDIT HERE: risk disclaimer wording shown on every client site (popup). */}
            <p>Trading derivatives involves risk. Options, multipliers and other Deriv products are complex instruments and may not suit every trader.</p>
            <p>Bots and signals follow the rules you set; they do not guarantee outcomes, and past performance does not indicate future results. We recommend practising on a demo account and setting clear limits before trading live.</p>
            <p className="hint">{site.name} is built on the Deriv API. Your funds stay in your Deriv account; this site can trade but can never withdraw.</p>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setDisclaimer(false)}>I understand</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="mono tp-clock">{now.toISOString().slice(0, 19).replace('T', ' ')} GMT</span>;
}
