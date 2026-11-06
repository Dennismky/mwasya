import { useMemo, useState } from 'react';
import { SYMBOLS, decimalsOf, lastDigit, useTicks } from './ticks';
import { isBotMarket, sendToBotBuilder, useMarket } from './market';
import { useNavigate } from 'react-router-dom';
import { toast } from '../components/motion';
import { useTrader } from './TraderApp';

/** Last-digit statistics over the most recent N ticks (live). Statistics describe the past only. */
export default function Analysis() {
  const [symbol, setSymbol] = useMarket(); // the bots trade this same market
  const [n, setN] = useState(1000);
  const [barrier, setBarrier] = useState(4);
  const { prices, ready } = useTicks(symbol, n);
  const { site, base } = useTrader();
  const navigate = useNavigate();
  // EDIT HERE: "Bot" buttons on D-Circles build a bot for this exact market and contract in Bot Builder.
  const toBot = (contract: string, prediction: number | undefined, label: string) => {
    sendToBotBuilder(site.subdomain, { symbol, contract, prediction });
    toast(`${label} bot on ${SYMBOLS.find((x) => x.id === symbol)?.name ?? symbol}`);
    navigate(`${base}/bot-builder`);
  };
  const canBot = isBotMarket(symbol);

  const s = useMemo(() => {
    const d = decimalsOf(prices);
    const digits = prices.map((p) => lastDigit(p, d));
    const count = Array(10).fill(0) as number[];
    digits.forEach((x) => count[x]++);
    const total = digits.length || 1;
    const pct = count.map((c) => (c / total) * 100);
    let rises = 0, moves = 0;
    for (let i = 1; i < prices.length; i++) { if (prices[i] !== prices[i - 1]) { moves++; if (prices[i] > prices[i - 1]) rises++; } }
    const max = Math.max(...pct), min = Math.min(...pct);
    return {
      pct, max, min, total: digits.length, recent: digits.slice(-40),
      even: (digits.filter((x) => x % 2 === 0).length / total) * 100,
      over: (digits.filter((x) => x > barrier).length / total) * 100,
      under: (digits.filter((x) => x < barrier).length / total) * 100,
      rise: moves ? (rises / moves) * 100 : 50,
    };
  }, [prices, barrier]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginRight: 'auto' }}>D-Circles</h1>
        <select className="input" style={{ width: 'auto' }} value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
          {SYMBOLS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Ticks">
          {[100, 500, 1000, 5000].map((x) => <option key={x} value={x}>Last {x} ticks</option>)}
        </select>
      </div>

      <DigitCircles pct={s.pct} max={s.max} min={s.min} live={s.recent[s.recent.length - 1]} price={prices[prices.length - 1]} decimals={decimalsOf(prices)} />

      <section className="card stack" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>Last digit distribution</b>
          <span className="hint">{ready ? `${s.total} ticks · live` : 'Loading…'}</span>
        </div>
        <div className="digit-bars">
          {s.pct.map((p, d) => (
            <div key={d} className={`digit-bar ${s.max === s.min ? '' : p === s.max ? 'hot' : p === s.min ? 'cold' : ''}`}>
              <span className="mono pct">{p.toFixed(1)}%</span>
              <span className="bar"><span style={{ height: `${Math.max(4, (p / Math.max(s.max, 1)) * 100)}%` }} /></span>
              <b className="digit">{d}</b>
            </div>
          ))}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Most recent last digits">
          {s.recent.map((d, i) => <span key={i} className={`digit-chip ${d % 2 ? 'odd' : 'even'}`}>{d}</span>)}
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
        <Split title="Even / Odd" a={['Even', s.even]} b={['Odd', 100 - s.even]} />
        <Split title="Rise / Fall (tick to tick)" a={['Rise', s.rise]} b={['Fall', 100 - s.rise]} />
        <section className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Over / Under</b>
            <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={barrier} onChange={(e) => setBarrier(Number(e.target.value))} aria-label="Barrier digit">
              {Array.from({ length: 10 }, (_, d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <Bar label={`Over ${barrier}`} v={s.over} tone="up" />
          <Bar label={`Under ${barrier}`} v={s.under} tone="down" />
          {canBot && (
            <div className="row an-bot" style={{ gap: 6 }}>
              <button className="btn btn-secondary" disabled={barrier > 8} onClick={() => toBot('DIGITOVER', barrier, `Over ${barrier}`)}>Bot: Over {barrier} →</button>
              <button className="btn btn-secondary" disabled={barrier < 1} onClick={() => toBot('DIGITUNDER', barrier, `Under ${barrier}`)}>Bot: Under {barrier} →</button>
            </div>
          )}
        </section>
      </div>
      <p className="hint">Statistics describe past ticks only. Synthetic indices are random, so past patterns don't predict the next tick.</p>
    </div>
  );
}

function Split({ title, a, b }: { title: string; a: [string, number]; b: [string, number] }) {
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <b>{title}</b>
      <Bar label={a[0]} v={a[1]} tone="up" />
      <Bar label={b[0]} v={b[1]} tone="down" />
    </section>
  );
}
function Bar({ label, v, tone }: { label: string; v: number; tone: 'up' | 'down' }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><span>{label}</span><b className="mono">{v.toFixed(1)}%</b></div>
      <div className="meter"><span className={tone} style={{ width: `${v}%` }} /></div>
    </div>
  );
}

/** Ten rings, one per last digit. The pointer glides to whichever digit Deriv's latest tick ends in. */
function DigitCircles({ pct, max, min, live, price, decimals }: { pct: number[]; max: number; min: number; live: number | undefined; price: number | undefined; decimals: number }) {
  return (
    <section className="card dc">
      <div className="dc-price mono" aria-live="polite">{price !== undefined ? price.toFixed(decimals) : '—'}</div>
      <div className="dc-row">
        {pct.map((p, d) => {
          // Green = most frequent, red = least. No colours until the ticks differ (e.g. while loading, every digit is 0%).
          const tone = max === min ? '' : p === max ? 'hot' : p === min ? 'cold' : '';
          return (
            <div key={d} className={`dc-c ${tone} ${live === d ? 'live' : ''}`} style={{ '--p': Math.min(100, p * 5) } as React.CSSProperties}>
              <div className="dc-ring"><div className="dc-face"><b>{d}</b><small>{p.toFixed(1)}%</small></div></div>
            </div>
          );
        })}
        {live !== undefined && <span className="dc-cursor" style={{ left: `${(live + 0.5) * 10}%` }} aria-label={`Last digit ${live}`} />}
      </div>
    </section>
  );
}
