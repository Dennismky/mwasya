import { useMemo, useState } from 'react';
import { TickChart } from './TickChart';
import { SYMBOLS, decimalsOf, useTicks } from './ticks';

export default function Charts() {
  const [symbol, setSymbol] = useState('1HZ100V');
  const [keep, setKeep] = useState(300);
  const { prices, times } = useTicks(symbol, keep);
  const decimals = useMemo(() => decimalsOf(prices), [prices.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = prices[0], last = prices[prices.length - 1];
  const change = first && last ? ((last - first) / first) * 100 : 0;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <select className="input mt-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
          {[...new Set(SYMBOLS.map((s) => s.group))].map((g) => (
            <optgroup key={g} label={g}>{SYMBOLS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          ))}
        </select>
        <b className="mono" style={{ fontSize: 22 }}>{last?.toFixed(decimals) ?? '—'}</b>
        <span className="mono" style={{ color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>{change >= 0 ? '+' : ''}{change.toFixed(3)}%</span>
        <span style={{ flex: 1 }} />
        <div className="seg" role="group" aria-label="Range">
          {[100, 300, 1000].map((n) => <button key={n} className={keep === n ? 'on' : ''} aria-pressed={keep === n} onClick={() => setKeep(n)}>{n} ticks</button>)}
        </div>
      </div>
      <section className="card" style={{ padding: 12 }}>
        <TickChart prices={prices} times={times} height={520} decimals={decimals} />
      </section>
    </div>
  );
}
