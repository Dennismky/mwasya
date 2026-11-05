import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../components/motion';
import { DEFAULT_CONFIG, type BotConfig } from './botEngine';
import { useTrader } from './TraderApp';
import { SYMBOLS, decimalsOf, lastDigit, tickHistory } from './ticks';

type Kind = 'even' | 'odd' | 'matches' | 'differs' | 'over' | 'under' | 'rise' | 'fall';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'even', label: 'Even' }, { id: 'odd', label: 'Odd' }, { id: 'matches', label: 'Matches' }, { id: 'differs', label: 'Differs' },
  { id: 'over', label: 'Over' }, { id: 'under', label: 'Under' }, { id: 'rise', label: 'Rise' }, { id: 'fall', label: 'Fall' },
];
const MARKETS = SYMBOLS.filter((s) => /^(1HZ|R_)/.test(s.id));
const CONTRACT: Record<Kind, BotConfig['contract']> = { matches: 'DIGITMATCH', over: 'DIGITOVER', under: 'DIGITUNDER', even: 'DIGITEVEN', odd: 'DIGITODD', differs: 'DIGITDIFF', rise: 'CALL', fall: 'PUT' };

interface Row { symbol: string; digits: number[]; rises: number; moves: number; last: number }
interface Scored { symbol: string; pct: number; digit?: number; last: number; recent: number[] }

/** Scans every volatility market's recent ticks from Deriv and ranks them for the chosen contract. Statistics describe the past only. */
export default function Signals() {
  const { site, base } = useTrader();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>('even');
  const [barrier, setBarrier] = useState(2);
  const [n, setN] = useState(1000);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<Date | null>(null);
  const [error, setError] = useState('');

  const scan = useCallback(async () => {
    setBusy(true); setError('');
    const results = await Promise.allSettled(MARKETS.map(async (m) => {
      const { prices } = await tickHistory(m.id, n);
      const d = decimalsOf(prices);
      let rises = 0, moves = 0;
      for (let i = 1; i < prices.length; i++) if (prices[i] !== prices[i - 1]) { moves++; if (prices[i] > prices[i - 1]) rises++; }
      return { symbol: m.id, digits: prices.map((p) => lastDigit(p, d)), rises, moves, last: prices[prices.length - 1] ?? 0 };
    }));
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ok.length) setError('Could not reach Deriv. Check your connection and scan again.');
    setRows(ok); setAt(new Date()); setBusy(false);
  }, [n]);

  useEffect(() => { void scan(); const t = setInterval(() => void scan(), 30_000); return () => clearInterval(t); }, [scan]);

  const ranked = useMemo<Scored[]>(() => rows.map((r) => {
    const total = r.digits.length || 1;
    const share = (f: (x: number) => boolean) => (r.digits.filter(f).length / total) * 100;
    const recent = r.digits.slice(-12);
    switch (kind) {
      case 'over': return { symbol: r.symbol, pct: share((x) => x > barrier), last: r.last, recent };
      case 'under': return { symbol: r.symbol, pct: share((x) => x < barrier), last: r.last, recent };
      case 'even': return { symbol: r.symbol, pct: share((x) => x % 2 === 0), last: r.last, recent };
      case 'odd': return { symbol: r.symbol, pct: share((x) => x % 2 === 1), last: r.last, recent };
      case 'matches': {
        const count = Array(10).fill(0) as number[]; r.digits.forEach((x) => count[x]++);
        const digit = count.indexOf(Math.max(...count));
        return { symbol: r.symbol, pct: (count[digit] / total) * 100, digit, last: r.last, recent };
      }
      case 'differs': {
        const count = Array(10).fill(0) as number[]; r.digits.forEach((x) => count[x]++);
        const digit = count.indexOf(Math.min(...count));
        return { symbol: r.symbol, pct: 100 - (count[digit] / total) * 100, digit, last: r.last, recent };
      }
      case 'rise': return { symbol: r.symbol, pct: r.moves ? (r.rises / r.moves) * 100 : 50, last: r.last, recent };
      case 'fall': return { symbol: r.symbol, pct: r.moves ? 100 - (r.rises / r.moves) * 100 : 50, last: r.last, recent };
    }
  }).sort((a, b) => b.pct - a.pct), [rows, kind, barrier]);

  // One row per market: the leaning side of each contract, from the same ticks.
  const board = useMemo(() => rows.map((r) => {
    const total = r.digits.length || 1;
    const count = Array(10).fill(0) as number[]; r.digits.forEach((x) => count[x]++);
    const even = (r.digits.filter((x) => x % 2 === 0).length / total) * 100;
    const hi = count.indexOf(Math.max(...count)), lo = count.indexOf(Math.min(...count));
    const rise = r.moves ? (r.rises / r.moves) * 100 : 50;
    return { symbol: r.symbol, even, odd: 100 - even, match: { digit: hi, pct: (count[hi] / total) * 100 }, differ: { digit: lo, pct: 100 - (count[lo] / total) * 100 }, rise, fall: 100 - rise };
  }), [rows]);
  const top = ranked[0];
  const applySignal = (s: Scored, k: Kind = kind) => {
    const key = `mw_bot_${site.subdomain}`;
    let saved: Partial<BotConfig> = {};
    try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* fresh */ }
    const prediction = k === 'over' || k === 'under' ? barrier : k === 'differs' || k === 'matches' ? s.digit ?? 0 : saved.prediction ?? 1;
    localStorage.setItem(key, JSON.stringify({ ...DEFAULT_CONFIG, ...saved, symbol: s.symbol, contract: CONTRACT[k], prediction }));
    localStorage.removeItem(`${key}_xml`); localStorage.removeItem(`${key}_name`);
    toast(`${MARKETS.find((m) => m.id === s.symbol)?.name ?? s.symbol} set in Bot Builder`);
    navigate(`${base}/bot-builder`);
  };
  const barrierOk = kind === 'over' ? barrier <= 8 : kind === 'under' ? barrier >= 1 : true;

  return (
    <div className="stack sg" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 2, marginRight: 'auto' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Signals</h1>
          <span className="hint">Every volatility market, last {n} ticks from Deriv · {at ? `updated ${at.toLocaleTimeString()}` : 'scanning…'}</span>
        </div>
        <select className="input" style={{ width: 'auto' }} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Ticks">
          {[100, 500, 1000].map((x) => <option key={x} value={x}>Last {x} ticks</option>)}
        </select>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void scan()}>{busy ? 'Scanning…' : 'Scan now'}</button>
      </div>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="seg sg-kinds" role="group" aria-label="Contract">
          {KINDS.map((k) => <button key={k.id} className={kind === k.id ? 'on' : ''} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>)}
        </div>
        {(kind === 'over' || kind === 'under') && (
          <div className="digits" role="group" aria-label="Barrier">
            {Array.from({ length: 10 }, (_, d) => <button key={d} className={barrier === d ? 'on' : ''} aria-pressed={barrier === d} onClick={() => setBarrier(d)}>{d}</button>)}
          </div>
        )}
        {!barrierOk && <p className="error">{kind === 'over' ? 'Over needs a digit from 0 to 8.' : 'Under needs a digit from 1 to 9.'}</p>}
      </section>

      {error && <p className="error">{error}</p>}

      {top && barrierOk && (
        <section className="sg-top card spot">
          <div className="stack" style={{ gap: 4 }}>
            <small>STRONGEST NOW</small>
            <b>{MARKETS.find((m) => m.id === top.symbol)?.name}</b>
            <span className="hint">{KINDS.find((k) => k.id === kind)?.label}{kind === 'over' || kind === 'under' ? ` ${barrier}` : kind === 'differs' || kind === 'matches' ? ` ${top.digit}` : ''} · {top.pct.toFixed(1)}% of the last {n} ticks</span>
          </div>
          <div className="sg-ring" style={{ '--p': top.pct } as React.CSSProperties}><span>{top.pct.toFixed(0)}%</span></div>
          <button className="btn btn-primary" onClick={() => applySignal(top)}>Use in Bot Builder</button>
        </section>
      )}

      <section className="card sg-board">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <b>Signal board</b>
          <span className="hint">Every volatility market · last {n} ticks · tap a cell to use it</span>
        </div>
        <div className="sg-table" role="table">
          <div className="sg-tr sg-th" role="row"><span>Market</span><span>Even</span><span>Odd</span><span>Matches</span><span>Differs</span><span>Rise</span><span>Fall</span></div>
          {board.map((b) => (
            <div key={b.symbol} className="sg-tr" role="row">
              <span className="sg-mk">{MARKETS.find((m) => m.id === b.symbol)?.name.replace(' Index', '')}</span>
              <Cell v={b.even} best={b.even >= b.odd} onClick={() => applySignal({ symbol: b.symbol, pct: b.even, last: 0, recent: [] }, 'even')} />
              <Cell v={b.odd} best={b.odd > b.even} onClick={() => applySignal({ symbol: b.symbol, pct: b.odd, last: 0, recent: [] }, 'odd')} />
              <Cell v={b.match.pct} label={`${b.match.digit}`} best onClick={() => applySignal({ symbol: b.symbol, pct: b.match.pct, digit: b.match.digit, last: 0, recent: [] }, 'matches')} />
              <Cell v={b.differ.pct} label={`≠${b.differ.digit}`} best onClick={() => applySignal({ symbol: b.symbol, pct: b.differ.pct, digit: b.differ.digit, last: 0, recent: [] }, 'differs')} />
              <Cell v={b.rise} best={b.rise >= b.fall} onClick={() => applySignal({ symbol: b.symbol, pct: b.rise, last: 0, recent: [] }, 'rise')} />
              <Cell v={b.fall} best={b.fall > b.rise} onClick={() => applySignal({ symbol: b.symbol, pct: b.fall, last: 0, recent: [] }, 'fall')} />
            </div>
          ))}
          {board.length === 0 && <div className="sk" style={{ padding: 12 }}>{[1, 2, 3, 4].map((i) => <span key={i} style={{ height: 34 }} />)}</div>}
        </div>
      </section>

      <section className="card sg-list" aria-busy={busy}>
        {ranked.length === 0 && <div className="sk">{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ height: 44 }} />)}</div>}
        {barrierOk && ranked.map((s, i) => (
          <div key={s.symbol} className="sg-row" style={{ animationDelay: `${i * 30}ms` }}>
            <span className="sg-rank">{i + 1}</span>
            <span className="sg-name"><b>{MARKETS.find((m) => m.id === s.symbol)?.name.replace(' Index', '')}</b><small className="mono">{s.recent.join(' ')}</small></span>
            <span className="sg-bar"><i style={{ width: `${s.pct}%` }} /></span>
            <b className="mono sg-pct">{s.pct.toFixed(1)}%{kind === 'differs' && <small> ≠{s.digit}</small>}{kind === 'matches' && <small> ={s.digit}</small>}</b>
            <button className="btn btn-ghost sg-use" onClick={() => applySignal(s)}>Use</button>
          </div>
        ))}
      </section>
      <p className="hint">Percentages describe past ticks only. Every new tick is independent.</p>
    </div>
  );
}

function Cell({ v, label, best, onClick }: { v: number; label?: string; best?: boolean; onClick: () => void }) {
  return (
    <button className={`sg-cell ${best ? 'best' : ''}`} onClick={onClick} title="Use in Bot Builder">
      {label && <b>{label}</b>}<span className="mono">{v.toFixed(1)}%</span>
    </button>
  );
}
