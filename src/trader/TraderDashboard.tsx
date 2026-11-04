import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useTrader } from './TraderApp';

const TILES = [
  { to: '/app/quick-bot', label: 'Quick Bot', icon: <Icon.Chip />, text: 'Ready-made bots', f: 'bots' },
  { to: '/app/free-bots', label: 'Free Bots', icon: <Icon.Code />, text: 'Deriv Bot XML files', f: 'freebots' },
  { to: '/app/manual', label: 'Manual Trader', icon: <Icon.Window />, text: 'Trade by hand', f: 'manual' },
  { to: '/app/charts', label: 'Charts', icon: <Icon.Chart />, text: 'Live prices', f: 'charts' },
  { to: '/app/analysis', label: 'Analysis Tools', icon: <Icon.Help />, text: 'Digit statistics', f: 'analysis' },
  { to: '/app/risk', label: 'Risk Calculator', icon: <Icon.Card />, text: 'Plan your stakes', f: 'risk' },
];

const FAQ = [
  ['Is my money safe here?', 'Your funds stay in your Deriv account. This site can place trades for you but can never withdraw.'],
  ['Demo or real?', 'Use the account switcher at the top. Practise on Demo first; it uses virtual money.'],
  ['How do Quick Bots stop?', 'Every bot has a take-profit and a stop-loss. Deriv stops it when either is reached, or when you press Stop.'],
  ['How do I use a Free Bot file?', 'Download the .xml file, open Deriv Bot, choose Import, and select the file.'],
];

export default function TraderDashboard() {
  const { site, bots, xmlBots } = useTrader();
  const auth = useAuth();
  const has = (f: string) => !site.features?.length || site.features.includes(f);
  return (
    <div className="tp-dash">
      <section className="tp-hero">
        <h1>Welcome{auth.account ? <>, <span className="mono">{auth.account.id}</span></> : ''}!</h1>
        <p>{site.tagline || 'Pick a ready-made bot, trade by hand, or study the market first. Everything runs on your own Deriv account.'}</p>
        <div className="tp-tiles">
          {TILES.filter((t) => has(t.f)).map((t) => (
            <Link key={t.to} to={t.to} className="tp-tile">
              <span className="tp-tile-icon">{t.icon}</span>
              <b>{t.label}</b>
              <span className="hint">{t.text}</span>
            </Link>
          ))}
        </div>
      </section>
      <aside className="stack" style={{ gap: 14 }}>
        <section className="card stack" style={{ gap: 8 }}>
          <b style={{ fontSize: 18 }}>Welcome to {site.name}</b>
          <span className="muted">Automated trading without coding. {bots.length} bot{bots.length === 1 ? '' : 's'} and {xmlBots.length} bot file{xmlBots.length === 1 ? '' : 's'} ready for you.</span>
        </section>
        <section className="card stack" style={{ gap: 8 }}>
          <b>Get started</b>
          <ol className="hint" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>Switch to your <b>Demo</b> account.</li>
            <li>Open <Link to="/app/quick-bot">Quick Bot</Link> and run a bot.</li>
            <li>Watch the results, then decide on real money.</li>
          </ol>
        </section>
        {has('learn') && <section className="card stack" style={{ gap: 4 }}>
          <b>Quick answers</b>
          {FAQ.map(([q, a]) => (
            <details key={q} className="tp-faq"><summary>{q}</summary><p className="hint">{a}</p></details>
          ))}
        </section>}
      </aside>
    </div>
  );
}
