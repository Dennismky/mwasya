import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useOutletContext, Outlet } from 'react-router-dom';
import { Icon } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { reloadTenant, type PublishedBot, type SiteBranding } from '../lib/tenant';
import { useBotRunner } from '../lib/useBotRunner';
import { runPnL } from '../lib/autoTrade';
import Analysis from './Analysis';
import Charts from './Charts';
import FreeBots from './FreeBots';
import ManualTrader from './ManualTrader';
import QuickBot from './QuickBot';
import RiskCalculator from './RiskCalculator';
import TraderDashboard from './TraderDashboard';
import BotBuilderSoon from './BotBuilderSoon';
import { Ticker } from './Ticker';

export interface XmlBotLite { id: string; name: string; description: string }
export interface TraderCtx {
  site: SiteBranding;
  bots: PublishedBot[];
  xmlBots: XmlBotLite[];
  runner: ReturnType<typeof useBotRunner>;
}
export const useTrader = () => useOutletContext<TraderCtx>();

const TABS: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: '/app', label: 'Dashboard', icon: <Icon.Chart />, end: true },
  { to: '/app/bot-builder', label: 'Bot Builder', icon: <Icon.Gear /> },
  { to: '/app/free-bots', label: 'Free Bots', icon: <Icon.Code /> },
  { to: '/app/quick-bot', label: 'Quick Bot', icon: <Icon.Chip /> },
  { to: '/app/manual', label: 'Manual Trader', icon: <Icon.Window /> },
  { to: '/app/charts', label: 'Charts', icon: <Icon.Chart /> },
  { to: '/app/analysis', label: 'Analysis Tools', icon: <Icon.Help /> },
  { to: '/app/risk', label: 'Risk Calculator', icon: <Icon.Card /> },
];

/** `/app/*` on <brand>.mwasya.site — the client trading platform. */
export default function TraderApp({ site, bots, xmlBots }: { site: SiteBranding; bots: PublishedBot[]; xmlBots: XmlBotLite[] }) {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Shell site={site} initialBots={bots} initialXml={xmlBots} />}>
          <Route index element={<TraderDashboard />} />
          <Route path="bot-builder" element={<BotBuilderSoon />} />
          <Route path="free-bots" element={<FreeBots />} />
          <Route path="quick-bot" element={<QuickBot />} />
          <Route path="manual" element={<ManualTrader />} />
          <Route path="charts" element={<Charts />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="risk" element={<RiskCalculator />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

function Shell({ site, initialBots, initialXml }: { site: SiteBranding; initialBots: PublishedBot[]; initialXml: XmlBotLite[] }) {
  const auth = useAuth();
  const [bots, setBots] = useState(initialBots);
  const [xmlBots, setXmlBots] = useState(initialXml);
  const [menu, setMenu] = useState(false);
  const [disclaimer, setDisclaimer] = useState(false);
  const runner = useBotRunner(auth.account?.id, auth.expire, auth.refreshBalance);
  const dark = site.theme === 'dark';

  useEffect(() => {
    reloadTenant().then((t) => { if (t.kind === 'site') { setBots(t.bots); setXmlBots(t.xmlBots ?? []); } }).catch(() => undefined);
  }, []);

  if (auth.status === 'signed-out') return <Navigate to="/" replace state={{ from: '/app', error: auth.error }} />;
  if (auth.status === 'checking') return <div className="shell-loading"><span className="spinner" /> Loading…</div>;

  const account = auth.account;
  const live = Object.values(runner.runs).filter((r) => r.status !== 'stopped');
  const livePnl = live.reduce((s, r) => s + runPnL(r), 0);
  const style = { '--primary': site.accent, '--primary-hover': site.accent, '--accent': site.accent } as CSSProperties;

  return (
    <div className={`tp ${dark ? 'tp-dark' : ''}`} style={style} data-theme={dark ? 'dark' : undefined}>
      <header className="tp-head">
        <span className="brand-mark" style={{ background: site.accent }}>{site.name.charAt(0).toUpperCase()}</span>
        <div className="stack" style={{ lineHeight: 1.1 }}>
          <b style={{ fontSize: 16 }}>{site.name}</b>
          <span className="hint" style={{ fontSize: 10, letterSpacing: '.08em' }}>{site.subdomain.toUpperCase()}</span>
        </div>
        <span style={{ flex: 1 }} />
        <a className="btn tp-deposit" href="https://app.deriv.com/cashier/deposit" target="_blank" rel="noreferrer">Deposit</a>
        <label className="tp-acct">
          <span className={`dot ${account?.isVirtual ? 'dot-demo' : 'dot-real'}`} />
          <b className="mono">{auth.balance}</b>
          <select value={account?.id ?? ''} onChange={(e) => auth.setAccountId(e.target.value)} aria-label="Trading account">
            {auth.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost tp-user" aria-label="Account menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon.Users />
          </button>
          {menu && (
            <div className="tp-menu" role="menu">
              <span className="hint mono" style={{ padding: '6px 10px' }}>{account?.id}</span>
              <button role="menuitem" onClick={auth.signOut}><Icon.Logout /> Log out</button>
            </div>
          )}
        </div>
      </header>

      <nav className="tp-nav" aria-label="Trading tools">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tp-tab ${isActive ? 'active' : ''}`}>
            {t.icon}{t.label}
          </NavLink>
        ))}
      </nav>
      <Ticker />

      <main className="tp-main">
        {account && !account.isVirtual && (
          <div className="tp-real">You're on a <b>real money</b> account. Switch to Demo in the top bar to practise.</div>
        )}
        <Outlet context={{ site, bots, xmlBots, runner } satisfies TraderCtx} />
      </main>

      <footer className="tp-foot">
        <button className="btn tp-disclaimer" onClick={() => setDisclaimer(true)}>Risk Disclaimer</button>
        <span className="tp-status">
          {live.length > 0
            ? <><span className="dot dot-real pulse" /> {live.length} bot{live.length > 1 ? 's' : ''} running · <b className="mono" style={{ color: livePnl >= 0 ? 'var(--success)' : 'var(--danger)' }}>{livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)}</b></>
            : <><span className={`dot ${runner.conn === 'ready' ? 'dot-real' : 'dot-demo'}`} /> {runner.conn === 'ready' ? 'Connected' : 'Connecting…'}</>}
        </span>
        <Clock />
      </footer>

      {disclaimer && (
        <div className="tp-modal" role="dialog" aria-modal="true" aria-labelledby="rd-title" onClick={() => setDisclaimer(false)}>
          <div className="card stack" style={{ gap: 12, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h2 id="rd-title" style={{ fontSize: 20, fontWeight: 700 }}>Risk Disclaimer</h2>
            <p>Deriv offers complex derivatives, such as options and contracts for difference. These products may not be suitable for everyone. Trading is risky, and you could lose all of your stake.</p>
            <p>Bots and signals do not guarantee profit. Past results don't predict future results. Only trade with money you can afford to lose, and practise on a demo account first.</p>
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
