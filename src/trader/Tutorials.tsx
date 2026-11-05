import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTrader } from './TraderApp';

interface Guide { id: string; title: string; time: string; to?: string; cta?: string; steps: string[] }

const GUIDES: Guide[] = [
  { id: 'start', title: 'Get started', time: '2 min', to: '', cta: 'Open Dashboard', steps: [
    'Sign in with your Deriv account. You type your password on Deriv\'s own page.',
    'Tap the account button at the top right.',
    'Choose the Demo tab and pick your demo account.',
    'Practise on demo until you are comfortable.',
  ] },
  { id: 'builder', title: 'Run a bot in Bot Builder', time: '3 min', to: '/bot-builder', cta: 'Open Bot Builder', steps: [
    'Step 1: pick a market and a contract (e.g. Over 1).',
    'Step 2: choose to buy straight away or after a digit.',
    'Step 3: set your stake and recovery (Martingale or Add the loss).',
    'Step 4: set take profit and stop loss.',
    'Press Run. Press Stop any time; the open trade finishes first.',
  ] },
  { id: 'xml', title: 'Load a bot file (XML)', time: '1 min', to: '/bot-builder', cta: 'Import a bot', steps: [
    'Open Bot Builder.',
    'Tap Import XML and choose the file, or pick a free bot from the list.',
    'Check the stake, martingale, take profit and stop loss it loaded.',
    'Edit anything you want, then press Run.',
  ] },
  { id: 'signals', title: 'Use Signals', time: '2 min', to: '/signals', cta: 'Open Signals', steps: [
    'Choose a contract: Over, Under, Even, Odd, Differs, Rise or Fall.',
    'For Over/Under, choose the digit.',
    'Markets are ranked by how often that result happened in recent ticks.',
    'Tap Use to send the market and contract to Bot Builder.',
  ] },
  { id: 'manual', title: 'Trade by hand', time: '2 min', to: '/manual', cta: 'Open Manual Trader', steps: [
    'Pick a market and a trade type.',
    'Set the stake and duration.',
    'Check the payout shown before you buy.',
    'Tap Buy. Follow it live in Reports.',
  ] },
  { id: 'plan', title: 'Plan your day', time: '1 min', to: '/risk', cta: 'Open Daily Plan', steps: [
    'Choose Safe, Balanced or Bold.',
    'Read your stake, profit target and loss limit.',
    'Tap Use this plan in Bot Builder.',
    'Stop for the day when you reach either limit.',
  ] },
  { id: 'reports', title: 'Check your results', time: '1 min', to: '/reports', cta: 'Open Reports', steps: [
    'Open positions show live profit and loss. Sell early if you want.',
    'Statement lists every deposit, buy and sell.',
    'Profit table shows each closed trade.',
  ] },
];

/** Short step-by-step guides for every tool on the site. */
export default function Tutorials() {
  const { base, site } = useTrader();
  const [open, setOpen] = useState('start');
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Tutorials</h1>
        <span className="hint">How to use {site.name}, one tool at a time.</span>
      </div>
      <div className="tu">
        {GUIDES.map((g, i) => (
          <section key={g.id} className={`tu-item card ${open === g.id ? 'on' : ''}`}>
            <button className="tu-head" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? '' : g.id)}>
              <span className="tu-num">{i + 1}</span>
              <b>{g.title}</b>
              <small>{g.time}</small>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open === g.id && (
              <div className="tu-body">
                <ol>{g.steps.map((s, j) => <li key={j}><span>{j + 1}</span>{s}</li>)}</ol>
                {g.to !== undefined && <Link className="btn btn-primary" to={base + g.to}>{g.cta}</Link>}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
