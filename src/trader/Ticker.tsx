import { useEffect, useState } from 'react';
import { subscribeTicks } from './ticks';

const TAPE = [
  ['RDBULL', 'BULL MARKET'], ['RDBEAR', 'BEAR MARKET'], ['1HZ10V', 'VOL 10 (1s)'], ['1HZ25V', 'VOL 25 (1s)'], ['1HZ50V', 'VOL 50 (1s)'],
  ['1HZ75V', 'VOL 75 (1s)'], ['1HZ100V', 'VOL 100 (1s)'], ['R_10', 'VOL 10'], ['R_50', 'VOL 50'], ['R_100', 'VOL 100'],
  ['BOOM500', 'BOOM 500'], ['CRASH500', 'CRASH 500'],
] as const;

/** Scrolling live price strip. Pauses on hover; respects reduced-motion. */
export function Ticker() {
  const [q, setQ] = useState<Record<string, { v: number; up: boolean }>>({});
  useEffect(() => {
    const offs = TAPE.map(([id]) => subscribeTicks(id, (v) => setQ((s) => ({ ...s, [id]: { v, up: v >= (s[id]?.v ?? v) } }))));
    return () => offs.forEach((o) => o());
  }, []);
  const items = TAPE.map(([id, label]) => (
    <span key={id} className="tk-item">
      <b>{label}</b> <span className="mono">{q[id]?.v ?? '—'}</span> <span className={q[id]?.up === false ? 'tk-down' : 'tk-up'}>{q[id]?.up === false ? '▼' : '▲'}</span>
    </span>
  ));
  return (
    <div className="ticker" aria-label="Live prices">
      <div className="ticker-track">{items}{items}</div>
    </div>
  );
}
