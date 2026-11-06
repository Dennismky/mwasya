import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../components/motion';
import { DEFAULT_CONFIG, type BotConfig } from './botEngine';
import { useTrader } from './TraderApp';
import { SYMBOLS, decimalsOf, lastDigit, tickHistory } from './ticks';
import { setMarket } from './market';

type Kind = 'even' | 'odd' | 'matches' | 'differs' | 'over' | 'under' | 'rise' | 'fall';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'even', label: 'Even' }, { id: 'odd', label: 'Odd' }, { id: 'matches', label: 'Matches' }, { id: 'differs', label: 'Differs' },
  { id: 'over', label: 'Over' }, { id: 'under', label: 'Under' }, { id: 'rise', label: 'Rise' }, { id: 'fall', label: 'Fall' },
];
/** Named setups on the strategy desk. Each one is a contract (+ digit) applied to the market that currently leans its way most. */
// EDIT HERE: strategy desk cards (name, contract, digit). 'kind' is one of the Kind values above.
const STRATEGIES: { id: string; name: string; kind: Kind; barrier?: number; note: string }[] = [
  { id: 'even', name: 'Even Pressure', kind: 'even', note: 'Even digits leading' },
  { id: 'odd', name: 'Odd Pressure', kind: 'odd', note: 'Odd digits leading' },
  { id: 'hunt', name: 'Digit Hunter', kind: 'matches', note: 'Most frequent digit' },
  { id: 'shield', name: 'Differ Shield', kind: 'differs', note: 'Rarest digit' },
  { id: 'over2', name: 'Over 2 Engine', kind: 'over', barrier: 2, note: 'Digits above 2' },
  { id: 'under7', name: 'Under 7 Engine', kind: 'under', barrier: 7, note: 'Digits below 7' },
  { id: 'rise', name: 'Momentum Rise', kind: 'rise', note: 'Upticks leading' },
  { id: 'fall', name: 'Momentum Fall', kind: 'fall', note: 'Downticks leading' },
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

  // One row per market: the leaning side of each contract, from the same ticks.
  const board = useMemo(() => rows.map((r) => {
    const total = r.digits.length || 1;
    const count = Array(10).fill(0) as number[]; r.digits.forEach((x) => count[x]++);
    const even = (r.digits.filter((x) => x % 2 === 0).length / total) * 100;
    const hi = count.indexOf(Math.max(...count)), lo = count.indexOf(Math.min(...count));
    const rise = r.moves ? (r.rises / r.moves) * 100 : 50;
    return { symbol: r.symbol, even, odd: 100 - even, match: { digit: hi, pct: (count[hi] / total) * 100 }, differ: { digit: lo, pct: 100 - (count[lo] / total) * 100 }, rise, fall: 100 - rise, recent: r.digits.slice(-8) };
  }), [rows]);
  const applySignal = (s: Scored, k: Kind = kind, b: number = barrier) => {
    const key = `mw_bot_${site.subdomain}`;
    let saved: Partial<BotConfig> = {};
    try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* fresh */ }
    const prediction = k === 'over' || k === 'under' ? b : k === 'differs' || k === 'matches' ? s.digit ?? 0 : saved.prediction ?? 1;
    localStorage.setItem(key, JSON.stringify({ ...DEFAULT_CONFIG, ...saved, symbol: s.symbol, contract: CONTRACT[k], prediction }));
    localStorage.removeItem(`${key}_xml`); localStorage.removeItem(`${key}_name`);
    setMarket(s.symbol);
    toast(`${MARKETS.find((m) => m.id === s.symbol)?.name ?? s.symbol} set in Bot Builder`);
    navigate(`${base}/bot-builder`);
  };
  const barrierOk = kind === 'over' ? barrier <= 8 : kind === 'under' ? barrier >= 1 : true;

  // Board column for the chosen contract: rows are sorted by it and the column is highlighted.
  const col: 'even' | 'odd' | 'match' | 'differ' | 'rise' | 'fall' | null =
    kind === 'even' ? 'even' : kind === 'odd' ? 'odd' : kind === 'matches' ? 'match' : kind === 'differs' ? 'differ' : kind === 'rise' ? 'rise' : kind === 'fall' ? 'fall' : null;
  const val = (b: (typeof board)[number], c: NonNullable<typeof col>) => (c === 'match' ? b.match.pct : c === 'differ' ? b.differ.pct : b[c]);
  const sortedBoard = col ? [...board].sort((a, b) => val(b, col) - val(a, col)) : board;
  // Strategy desk: named setups, each scored on every market from the same ticks; the best market is shown.
  const desk = useMemo(() => STRATEGIES.map((st) => {
    let best: { symbol: string; pct: number; digit?: number; recent: number[]; score: number } | null = null;
    for (const r of rows) {
      const total = r.digits.length || 1;
      const count = Array(10).fill(0) as number[]; r.digits.forEach((x) => count[x]++);
      let pct = 0, digit: number | undefined, fair = 50, span = 6;
      if (st.kind === 'even') pct = (r.digits.filter((x) => x % 2 === 0).length / total) * 100;
      else if (st.kind === 'odd') pct = (r.digits.filter((x) => x % 2 === 1).length / total) * 100;
      else if (st.kind === 'matches') { digit = count.indexOf(Math.max(...count)); pct = (count[digit] / total) * 100; fair = 10; span = 3; }
      else if (st.kind === 'differs') { digit = count.indexOf(Math.min(...count)); pct = 100 - (count[digit] / total) * 100; fair = 90; span = 3; }
      else if (st.kind === 'over') { pct = (r.digits.filter((x) => x > (st.barrier ?? 2)).length / total) * 100; fair = (9 - (st.barrier ?? 2)) * 10; }
      else if (st.kind === 'under') { pct = (r.digits.filter((x) => x < (st.barrier ?? 7)).length / total) * 100; fair = (st.barrier ?? 7) * 10; }
      else if (st.kind === 'rise') pct = r.moves ? (r.rises / r.moves) * 100 : 50;
      else pct = r.moves ? 100 - (r.rises / r.moves) * 100 : 50;
      const score = Math.max(0, Math.min(1, (pct - fair) / span));
      if (!best || score > best.score || (score === best.score && pct > best.pct)) best = { symbol: r.symbol, pct, digit, recent: r.digits.slice(-10), score };
    }
    return { ...st, best };
  }), [rows]);
  const strength = (s: number) => (s >= 0.6 ? 'Strong' : s >= 0.25 ? 'Moderate' : 'Weak');

  const kindLabel = KINDS.find((k) => k.id === kind)?.label ?? '';
  // Heat: how far a reading leans from a fair split (50% for two-sided, 10% for one digit).
  const heat = (v: number, fair = 50, span = 6) => Math.max(0, Math.min(1, (v - fair) / span));

  // Countdown ring to the next automatic scan.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const next = at ? Math.max(0, 30 - Math.floor((now - at.getTime()) / 1000)) : 30;

  return (
    <div className="stack sg sg2" style={{ gap: 14 }}>
      <header className="sg2-head">
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h1>Signals</h1>
          <span className="hint">{MARKETS.length} volatility markets · last {n} ticks from Deriv{at ? ` · ${at.toLocaleTimeString()}` : ''}</span>
        </div>
        <div className="sg2-ctrl">
          <span className={`sg2-timer ${busy ? 'busy' : ''}`} style={{ '--p': ((30 - next) / 30) * 100 } as React.CSSProperties} title="Next automatic scan">
            <span className="mono">{busy ? '…' : `${next}s`}</span>
          </span>
          <select className="input" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Ticks">
            {[100, 500, 1000].map((x) => <option key={x} value={x}>Last {x} ticks</option>)}
          </select>
          <button className="sg2-scan" disabled={busy} onClick={() => void scan()} title="Scan now" aria-label="Scan now">↻</button>
        </div>
      </header>

      <section className="sg2-kinds" role="group" aria-label="Contract">
        {KINDS.map((k) => (
          <button key={k.id} className={`sg2-kind k-${k.id} ${kind === k.id ? 'on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
        {(kind === 'over' || kind === 'under') && (
          <div className="sg2-digits" role="group" aria-label="Barrier digit">
            <span className="hint">{kind === 'over' ? 'Over' : 'Under'}</span>
            {Array.from({ length: 10 }, (_, d) => <button key={d} className={barrier === d ? 'on' : ''} aria-pressed={barrier === d} onClick={() => setBarrier(d)}>{d}</button>)}
          </div>
        )}
      </section>
      {!barrierOk && <p className="error">{kind === 'over' ? 'Over needs a digit from 0 to 8.' : 'Under needs a digit from 1 to 9.'}</p>}
      {error && <p className="error">{error}</p>}

      <section className="sd" aria-label="Strategy desk">
        <div className="sd-head"><b>Strategy desk</b><span className="hint">Best market for each setup right now · tap Run to build it</span></div>
        <div className="sd-grid">
          {desk.map((d, i) => {
            const b = d.best;
            const lvl = b ? strength(b.score) : '';
            return (
              <article key={d.id} className={`sd-card lv-${lvl.toLowerCase()}`} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="sd-top">
                  <b className="sd-name">{d.name}</b>
                  {b && <span className={`sd-lvl lv-${lvl.toLowerCase()}`}>{lvl}</span>}
                </div>
                <span className="sd-note">{d.note}{d.kind === 'matches' || d.kind === 'differs' ? (b?.digit !== undefined ? ` · ${d.kind === 'differs' ? '≠' : ''}${b.digit}` : '') : ''}</span>
                {b ? (
                  <>
                    <div className="sd-mk">
                      <span>{MARKETS.find((m) => m.id === b.symbol)?.name.replace(' Index', '')}</span>
                      <b className="mono">{b.pct.toFixed(1)}%</b>
                    </div>
                    <div className="sd-meter" aria-label={`Strength ${Math.round(b.score * 100)}%`}><i style={{ width: `${Math.max(6, b.score * 100)}%` }} /></div>
                    <span className="sg2-dots">{b.recent.map((x, j) => <i key={j} className={x % 2 ? 'o' : 'e'}>{x}</i>)}</span>
                    <button className="sd-run" onClick={() => applySignal({ symbol: b.symbol, pct: b.pct, digit: b.digit, last: 0, recent: [] }, d.kind, d.barrier ?? barrier)}>▶ Run</button>
                  </>
                ) : <div className="sk"><span style={{ height: 70 }} /></div>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="card sg-board sg2-board">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <b>Signal board</b>
          <span className="hint">Sorted by {kindLabel}{col ? '' : ' (choose Even/Odd/Matches/Differs/Rise/Fall to sort)'} · tap a cell to use it</span>
        </div>
        <div className="sg-table" role="table">
          <div className={`sg-tr sg-th col-${col ?? 'none'}`} role="row">
            <span>Market</span><span className="c-even">Even</span><span className="c-odd">Odd</span><span className="c-match">Matches</span><span className="c-differ">Differs</span><span className="c-rise">Rise</span><span className="c-fall">Fall</span>
          </div>
          {sortedBoard.map((b, i) => (
            <div key={b.symbol} className={`sg-tr col-${col ?? 'none'}`} role="row" style={{ animationDelay: `${i * 25}ms` }}>
              <span className="sg-mk">
                <span>{MARKETS.find((m) => m.id === b.symbol)?.name.replace(' Index', '')}</span>
                <span className="sg2-dots small">{b.recent.map((d, j) => <i key={j} className={d % 2 ? 'o' : 'e'} />)}</span>
              </span>
              <Cell c="c-even" v={b.even} h={heat(b.even)} onClick={() => applySignal({ symbol: b.symbol, pct: b.even, last: 0, recent: [] }, 'even')} />
              <Cell c="c-odd" v={b.odd} h={heat(b.odd)} onClick={() => applySignal({ symbol: b.symbol, pct: b.odd, last: 0, recent: [] }, 'odd')} />
              <Cell c="c-match" v={b.match.pct} label={`${b.match.digit}`} h={heat(b.match.pct, 10, 3)} onClick={() => applySignal({ symbol: b.symbol, pct: b.match.pct, digit: b.match.digit, last: 0, recent: [] }, 'matches')} />
              <Cell c="c-differ" v={b.differ.pct} label={`≠${b.differ.digit}`} h={heat(b.differ.pct, 90, 3)} onClick={() => applySignal({ symbol: b.symbol, pct: b.differ.pct, digit: b.differ.digit, last: 0, recent: [] }, 'differs')} />
              <Cell c="c-rise" v={b.rise} h={heat(b.rise)} onClick={() => applySignal({ symbol: b.symbol, pct: b.rise, last: 0, recent: [] }, 'rise')} />
              <Cell c="c-fall" v={b.fall} h={heat(b.fall)} onClick={() => applySignal({ symbol: b.symbol, pct: b.fall, last: 0, recent: [] }, 'fall')} />
            </div>
          ))}
          {board.length === 0 && <div className="sk" style={{ padding: 12 }}>{[1, 2, 3, 4].map((i) => <span key={i} style={{ height: 40 }} />)}</div>}
        </div>
      </section>
      <p className="hint">Percentages describe past ticks only. Every new tick is independent.</p>
    </div>
  );
}

function Cell({ v, label, h, c, onClick }: { v: number; label?: string; h: number; c: string; onClick: () => void }) {
  return (
    <button className={`sg-cell ${c} ${h > 0.15 ? 'best' : ''}`} style={{ '--h': h } as React.CSSProperties} onClick={onClick} title="Use in Bot Builder">
      {label && <b>{label}</b>}<span className="mono">{v.toFixed(1)}%</span>
    </button>
  );
}
