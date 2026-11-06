import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { toast } from '../components/motion';
import { DEFAULT_CONFIG } from './botEngine';
import { useTrader } from './TraderApp';

// EDIT HERE: Daily Plan presets (target %, stop loss %, losing trades allowed).
const PLANS = {
  safe: { label: 'Safe', target: 2, stop: 4, trades: 10 },
  balanced: { label: 'Balanced', target: 5, stop: 10, trades: 10 },
  bold: { label: 'Bold', target: 10, stop: 20, trades: 8 },
} as const;
type PlanKey = keyof typeof PLANS | 'custom';

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Daily plan: a profit target, a stop loss and a stake that fits them. Pure maths, nothing is sent anywhere. */
export default function RiskCalculator() {
  const { site, base } = useTrader();
  const auth = useAuth();
  const navigate = useNavigate();
  const live = Number(String(auth.balance).replace(/[^\d.]/g, ''));
  const currency = auth.account?.currency ?? 'USD';

  const [balance, setBalance] = useState(live > 0 ? String(live) : '100');
  const [plan, setPlan] = useState<PlanKey>('safe');
  const [target, setTarget] = useState('2');
  const [stop, setStop] = useState('4');
  const [trades, setTrades] = useState('10');
  const [payout, setPayout] = useState('95');

  useEffect(() => { if (live > 0) setBalance(String(live)); }, [live]);

  const pick = (k: PlanKey) => {
    setPlan(k);
    if (k !== 'custom') { const p = PLANS[k]; setTarget(String(p.target)); setStop(String(p.stop)); setTrades(String(p.trades)); }
  };

  const r = useMemo(() => {
    const B = Number(balance), t = Number(target) / 100, s = Number(stop) / 100, n = Math.floor(Number(trades)), pay = Number(payout) / 100;
    if (!(B > 0 && t > 0 && s > 0 && s < 1 && n >= 1 && pay > 0)) return null;
    const goal = B * t, loss = B * s;
    const stake = Math.max(0.35, loss / n);
    const wins = Math.max(1, Math.ceil(goal / (stake * pay)));
    return { goal, loss, stake, wins, up: B + goal, down: B - loss, tooSmall: loss / n < 0.35 };
  }, [balance, target, stop, trades, payout]);

  const apply = () => {
    if (!r) return;
    const key = `mw_bot_${site.subdomain}`;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* fresh */ }
    localStorage.setItem(key, JSON.stringify({ ...DEFAULT_CONFIG, ...saved, stake: Number(r.stake.toFixed(2)), takeProfit: Number(r.goal.toFixed(2)), stopLoss: Number(r.loss.toFixed(2)), recovery: false }));
    // Opens Bot Builder's Quick strategy filled with this plan; the bot is built when the client presses "Build my bot".
    toast('Check your plan, then press Build my bot');
    navigate(`${base}/bot-builder?quick=1`);
  };

  const field = (label: string, v: string, set: (s: string) => void, suffix: string) => (
    <div className="field">
      <label className="label">{label}</label>
      <div className="input-group">
        <input className="input mono" inputMode="decimal" value={v} aria-label={label}
          onChange={(e) => { set(e.target.value.replace(/[^\d.]/g, '')); if (set !== setBalance && set !== setPayout) setPlan('custom'); }} />
        <span className="addon">{suffix}</span>
      </div>
    </div>
  );

  return (
    <div className="stack dp" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Daily Plan</h1>
        <p className="muted">Set today's target and limit. Stop when you hit either one.</p>
      </div>

      <section className="card stack" style={{ gap: 16 }}>
        <div className="seg dp-plans" role="group" aria-label="Plan">
          {(Object.keys(PLANS) as (keyof typeof PLANS)[]).map((k) => (
            <button key={k} className={plan === k ? 'on' : ''} onClick={() => pick(k)}>
              <b>{PLANS[k].label}</b><small>+{PLANS[k].target}% / −{PLANS[k].stop}%</small>
            </button>
          ))}
          <button className={plan === 'custom' ? 'on' : ''} onClick={() => pick('custom')}><b>Custom</b><small>Your numbers</small></button>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 14 }}>
          {field('Balance', balance, setBalance, currency)}
          {field('Daily target', target, setTarget, '%')}
          {field('Daily stop loss', stop, setStop, '%')}
          {field('Losing trades allowed', trades, setTrades, 'max')}
          {field('Profit per win', payout, setPayout, '%')}
        </div>
      </section>

      {!r ? <p className="error">Enter positive numbers. Stop loss must be below 100%.</p> : (
        <>
          <div className="dp-tiles">
            <section className="card dp-tile dp-win spot"><small>STOP AT PROFIT</small><b className="mono">+{money(r.goal)}</b><span>Balance {money(r.up)} {currency}</span></section>
            <section className="card dp-tile dp-loss spot"><small>STOP AT LOSS</small><b className="mono">−{money(r.loss)}</b><span>Balance {money(r.down)} {currency}</span></section>
            <section className="card dp-tile spot"><small>STAKE PER TRADE</small><b className="mono">{money(r.stake)}</b><span>{r.tooSmall ? 'Raised to the 0.35 minimum' : `${trades} losses reach your limit`}</span></section>
            <section className="card dp-tile spot"><small>WINS TO HIT TARGET</small><b className="mono">{r.wins}</b><span>Net wins at this stake</span></section>
          </div>

          <section className="card stack" style={{ gap: 12 }}>
            <div className="dp-bar" aria-hidden="true">
              <span className="dp-bar-loss" style={{ flex: r.loss }} />
              <span className="dp-bar-win" style={{ flex: r.goal }} />
              <i style={{ left: `${(r.loss / (r.loss + r.goal)) * 100}%` }} />
            </div>
            <div className="dp-scale mono">
              <span>{money(r.down)}</span><span>Start {money(Number(balance))}</span><span>{money(r.up)}</span>
            </div>
          </section>

          <ol className="dp-steps">
            <li><span>1</span>Trade at <b className="mono">{money(r.stake)} {currency}</b> per trade.</li>
            <li><span>2</span>Stop for the day at <b className="mono">+{money(r.goal)}</b>.</li>
            <li><span>3</span>Stop for the day at <b className="mono">−{money(r.loss)}</b>.</li>
          </ol>

          <button className="btn btn-primary dp-apply" onClick={apply}>Use this plan in Bot Builder</button>
        </>
      )}
    </div>
  );
}
