import { useEffect, useState } from 'react';
import { toast } from '../components/motion';
import { setMarket } from './market';
import { SYMBOLS, decimalsOf, subscribeTicks, tickHistory } from './ticks';

// EDIT HERE: markets in the moving price bar (Deriv symbol, short label).
const TAPE = [
  ['1HZ10V', 'V10 (1s)'], ['1HZ25V', 'V25 (1s)'], ['1HZ50V', 'V50 (1s)'], ['1HZ75V', 'V75 (1s)'], ['1HZ100V', 'V100 (1s)'],
  ['R_10', 'V10'], ['R_25', 'V25'], ['R_50', 'V50'], ['R_75', 'V75'], ['R_100', 'V100'],
  ['RDBULL', 'BULL'], ['RDBEAR', 'BEAR'], ['BOOM500', 'BOOM 500'], ['CRASH500', 'CRASH 500'],
] as const;
const SPARK = 24; // ticks drawn in each mini chart

interface Q { v: number; prev: number; first: number; hist: number[] }

/**
 * The moving price bar: one chip per market with a live mini chart, the change since the page opened, and the price's
 * last digit in a bubble. Each tick flashes green or red. Click a chip to analyse / trade that market everywhere.
 * Pauses on hover; still for clients who prefer reduced motion.
 */
export function Ticker() {
  const [q, setQ] = useState<Record<string, Q>>({});
  useEffect(() => {
    const offs = TAPE.map(([id]) => subscribeTicks(id, (v) => setQ((s) => {
      const o = s[id];
      return { ...s, [id]: { v, prev: o?.v ?? v, first: o?.first ?? v, hist: [...(o?.hist ?? []), v].slice(-SPARK) } };
    })));
    // Fill each mini chart with the last few ticks straight away (live ticks keep it moving after that).
    let alive = true;
    TAPE.forEach(([id]) => { tickHistory(id, SPARK).then((h) => {
      if (!alive || !h.prices.length) return;
      setQ((s) => { const o = s[id]; const hist = [...h.prices, ...(o?.hist ?? [])].slice(-SPARK); const v = o?.v ?? h.prices[h.prices.length - 1]; return { ...s, [id]: { v, prev: o?.prev ?? v, first: o?.first ?? v, hist } }; });
    }).catch(() => undefined); });
    return () => { alive = false; offs.forEach((o) => o()); };
  }, []);

  const pick = (id: string, label: string) => {
    if (!SYMBOLS.some((s) => s.id === id)) return;
    setMarket(id);
    toast(`${label} selected · D-Circles, Charts and bots now use it`);
  };

  const items = TAPE.map(([id, label]) => {
    const d = q[id];
    const dec = d ? Math.max(decimalsOf(d.hist), 2) : 2;
    const text = d ? d.v.toFixed(dec) : '';
    const dir = !d || d.v === d.prev ? 'flat' : d.v > d.prev ? 'up' : 'down';
    const chg = d && d.first ? ((d.v - d.first) / d.first) * 100 : 0;
    return (
      <button key={id} type="button" className={`tk-chip ${dir}`} onClick={() => pick(id, label)} title={`${label}: click to analyse and trade this market`}>
        <span className="tk-name">{label}</span>
        <Spark hist={d?.hist ?? []} />
        <span className="tk-px mono">{d ? <>{text.slice(0, -1)}<i className="tk-digit">{text.slice(-1)}</i></> : '—'}</span>
        <span className={`tk-chg mono ${chg > 0 ? 'up' : chg < 0 ? 'down' : ''}`}>{chg > 0 ? '▲' : chg < 0 ? '▼' : '•'} {Math.abs(chg).toFixed(2)}%</span>
        {d && <span className="tk-flash" key={d.hist.length + ':' + d.v} aria-hidden="true" />}
      </button>
    );
  });

  return (
    <div className="ticker" aria-label="Live prices">
      <span className="tk-live" aria-hidden="true"><span className="tk-live-dot" />LIVE</span>
      <div className="ticker-view">
        <div className="ticker-track">{items}<span className="tk-gap" aria-hidden="true" />{items}<span className="tk-gap" aria-hidden="true" /></div>
      </div>
    </div>
  );
}

/** Mini chart of the last ticks (no axes): accent line with a soft fill. */
function Spark({ hist }: { hist: number[] }) {
  const W = 46, H = 18;
  if (hist.length < 2) return <svg className="tk-spark" width={W} height={H} aria-hidden="true" />;
  const lo = Math.min(...hist), hi = Math.max(...hist), span = hi - lo || 1;
  const pts = hist.map((v, i) => `${((i / (SPARK - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return (
    <svg className="tk-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polygon points={`0,${H} ${pts.join(' ')} ${last[0]},${H}`} className="tk-spark-fill" />
      <polyline points={pts.join(' ')} className="tk-spark-line" />
      <circle cx={last[0]} cy={last[1]} r="1.8" className="tk-spark-dot" />
    </svg>
  );
}
