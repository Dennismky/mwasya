import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, LineSeries, createChart,
  type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp,
} from 'lightweight-charts';
import { publicSocket } from '../lib/derivWs';
import { SYMBOLS } from './ticks';

type Mode = 'ticks' | 'candles';
type Ind = 'sma' | 'ema' | 'bb' | 'rsi';
interface Candle { time: number; open: number; high: number; low: number; close: number }
interface Pt { time: number; value: number }

const FRAMES = [
  { g: 60, l: '1m' }, { g: 300, l: '5m' }, { g: 900, l: '15m' }, { g: 1800, l: '30m' },
  { g: 3600, l: '1h' }, { g: 14400, l: '4h' }, { g: 86400, l: '1D' },
];
const INDICATORS: { id: Ind; label: string; color: string }[] = [
  { id: 'sma', label: 'SMA 20', color: '#F5A524' },
  { id: 'ema', label: 'EMA 50', color: '#A855F7' },
  { id: 'bb', label: 'Bollinger 20', color: '#22B8CF' },
  { id: 'rsi', label: 'RSI 14', color: '#E5484D' },
];

/* ---------- indicator maths (on closing prices) ---------- */
const sma = (pts: Pt[], n: number): Pt[] => {
  const out: Pt[] = []; let sum = 0;
  pts.forEach((p, i) => { sum += p.value; if (i >= n) sum -= pts[i - n].value; if (i >= n - 1) out.push({ time: p.time, value: sum / n }); });
  return out;
};
const ema = (pts: Pt[], n: number): Pt[] => {
  const k = 2 / (n + 1); const out: Pt[] = []; let e: number | undefined;
  pts.forEach((p, i) => { e = e === undefined ? p.value : p.value * k + e * (1 - k); if (i >= n - 1) out.push({ time: p.time, value: e }); });
  return out;
};
const bollinger = (pts: Pt[], n: number, mult = 2) => {
  const up: Pt[] = [], lo: Pt[] = [];
  for (let i = n - 1; i < pts.length; i++) {
    const w = pts.slice(i - n + 1, i + 1).map((p) => p.value);
    const m = w.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / n);
    up.push({ time: pts[i].time, value: m + mult * sd }); lo.push({ time: pts[i].time, value: m - mult * sd });
  }
  return { up, lo };
};
const rsi = (pts: Pt[], n: number): Pt[] => {
  const out: Pt[] = []; let g = 0, l = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].value - pts[i - 1].value;
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; }
    if (i >= n) out.push({ time: pts[i].time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) });
  }
  return out;
};

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const t = (s: number) => s as UTCTimestamp;

/** TradingView-style live chart from Deriv: ticks or candles, time frames, and indicators. */
export default function Charts() {
  const [symbol, setSymbol] = useState('1HZ100V');
  const [mode, setMode] = useState<Mode>('candles');
  const [gran, setGran] = useState(60);
  const [inds, setInds] = useState<Ind[]>(['sma']);
  const [last, setLast] = useState<{ price: number; change: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const indRef = useRef(inds);
  indRef.current = inds;
  const redrawRef = useRef<() => void>(() => undefined);

  // Chart instance (one per page).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const dark = !!el.closest('.tp-dark');
    const text = dark ? '#C9D3E3' : '#33415C';
    const grid = dark ? 'rgba(255,255,255,.06)' : 'rgba(11,31,58,.06)';
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: text, fontFamily: 'Inter, system-ui, sans-serif', panes: { separatorColor: grid } },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 6 },
    });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // Data: history + live stream from Deriv's public feed.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setLoading(true); setError(''); setLast(null);
    const accent = css('--accent', '') || getComputedStyle(box.current!).getPropertyValue('--accent').trim() || '#1F4FD1';
    let main: ISeriesApi<SeriesType>;
    if (mode === 'candles') main = chart.addSeries(CandlestickSeries, { upColor: '#12A07A', downColor: '#E5484D', borderVisible: false, wickUpColor: '#12A07A', wickDownColor: '#E5484D' });
    else main = chart.addSeries(AreaSeries, { lineColor: accent, topColor: `${accent}55`, bottomColor: `${accent}05`, lineWidth: 2 });
    chart.timeScale().applyOptions({ secondsVisible: mode === 'ticks' || gran < 300 });

    let candles: Candle[] = [];
    let ticks: Pt[] = [];
    let extra: ISeriesApi<SeriesType>[] = [];
    let first = 0;

    const closes = (): Pt[] => (mode === 'candles' ? candles.map((c) => ({ time: c.time, value: c.close })) : ticks);
    const redraw = () => {
      if (chartRef.current !== chart) return;
      extra.forEach((s) => chart.removeSeries(s)); extra = [];
      const pts = closes();
      const on = indRef.current;
      const line = (data: Pt[], color: string, pane = 0, width: 1 | 2 = 2) => {
        const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
        s.setData(data.map((p) => ({ time: t(p.time), value: p.value })));
        extra.push(s);
      };
      if (on.includes('sma')) line(sma(pts, 20), '#F5A524');
      if (on.includes('ema')) line(ema(pts, 50), '#A855F7');
      if (on.includes('bb')) { const b = bollinger(pts, 20); line(b.up, '#22B8CF', 0, 1); line(b.lo, '#22B8CF', 0, 1); }
      if (on.includes('rsi')) {
        line(rsi(pts, 14), '#E5484D', 1);
        const r = extra[extra.length - 1];
        r.createPriceLine({ price: 70, color: 'rgba(229,72,77,.5)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        r.createPriceLine({ price: 30, color: 'rgba(18,160,122,.6)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        chart.panes()[1]?.setHeight(120);
      }
    };
    redrawRef.current = redraw;

    const ws = publicSocket();
    let stop: (() => void) | undefined;
    let alive = true;
    let lastRedraw = 0;
    const report = (price: number) => { if (!first) first = price; setLast({ price, change: ((price - first) / first) * 100 }); };
    const req = mode === 'candles'
      ? { ticks_history: symbol, style: 'candles', granularity: gran, count: 500, end: 'latest' }
      : { ticks_history: symbol, style: 'ticks', count: 1000, end: 'latest' };

    ws.subscribe(req, (m) => {
      if (!alive) return;
      const err = m.error as { message?: string } | undefined;
      if (err) { setError(err.message ?? 'Could not load the chart.'); setLoading(false); return; }
      if (m.candles) {
        candles = (m.candles as Candle[]).map((c) => ({ time: Number((c as unknown as { epoch: number }).epoch), open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
        main.setData(candles.map((c) => ({ ...c, time: t(c.time) })));
        first = candles[0]?.open ?? 0; report(candles[candles.length - 1]?.close ?? 0);
        redraw(); chart.timeScale().fitContent(); setLoading(false);
      } else if (m.history) {
        const h = m.history as { prices: number[]; times: number[] };
        ticks = h.times.map((tm, i) => ({ time: tm, value: +h.prices[i] }));
        main.setData(ticks.map((p) => ({ time: t(p.time), value: p.value })));
        first = ticks[0]?.value ?? 0; report(ticks[ticks.length - 1]?.value ?? 0);
        redraw(); chart.timeScale().fitContent(); setLoading(false);
      } else if (m.ohlc) {
        const o = m.ohlc as Record<string, string | number>;
        const c: Candle = { time: Number(o.open_time), open: +o.open, high: +o.high, low: +o.low, close: +o.close };
        if (candles.length && candles[candles.length - 1].time === c.time) candles[candles.length - 1] = c; else candles.push(c);
        main.update({ ...c, time: t(c.time) }); report(c.close);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      } else if (m.tick) {
        const k = m.tick as { epoch: number; quote: number };
        const p = { time: k.epoch, value: +k.quote };
        if (ticks.length && ticks[ticks.length - 1].time >= p.time) return;
        ticks.push(p); if (ticks.length > 2000) ticks.shift();
        main.update({ time: t(p.time), value: p.value }); report(p.value);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      }
    }).then((u) => { stop = u; if (!alive) u(); }).catch((e: Error) => { setError(e.message); setLoading(false); });

    return () => {
      alive = false; stop?.(); ws.close();
      // When the page closes, the chart itself is removed first: only tidy series on a chart that still exists.
      if (chartRef.current === chart) {
        try { extra.forEach((s) => chart.removeSeries(s)); chart.removeSeries(main); } catch { /* chart already gone */ }
      }
    };
  }, [symbol, mode, gran]);

  // Indicator toggles redraw without reloading data.
  useEffect(() => { redrawRef.current(); }, [inds]);

  const toggle = (id: Ind) => setInds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const name = SYMBOLS.find((s) => s.id === symbol)?.name ?? symbol;

  return (
    <div className="stack ch" style={{ gap: 12 }}>
      <div className="ch-bar card">
        <select className="input ch-sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
          {[...new Set(SYMBOLS.map((s) => s.group))].map((g) => (
            <optgroup key={g} label={g}>{SYMBOLS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
          ))}
        </select>
        <div className="seg ch-seg" role="group" aria-label="Chart type">
          <button className={mode === 'ticks' ? 'on' : ''} aria-pressed={mode === 'ticks'} onClick={() => setMode('ticks')}>Ticks</button>
          <button className={mode === 'candles' ? 'on' : ''} aria-pressed={mode === 'candles'} onClick={() => setMode('candles')}>Candles</button>
        </div>
        {mode === 'candles' && (
          <div className="seg ch-seg ch-frames" role="group" aria-label="Time frame">
            {FRAMES.map((f) => <button key={f.g} className={gran === f.g ? 'on' : ''} aria-pressed={gran === f.g} onClick={() => setGran(f.g)}>{f.l}</button>)}
          </div>
        )}
        <div className="ch-inds" role="group" aria-label="Indicators">
          {INDICATORS.map((i) => (
            <button key={i.id} className={`ch-ind ${inds.includes(i.id) ? 'on' : ''}`} aria-pressed={inds.includes(i.id)} onClick={() => toggle(i.id)} style={{ '--ic': i.color } as React.CSSProperties}>
              <i />{i.label}
            </button>
          ))}
        </div>
      </div>

      <section className="card ch-card">
        <div className="ch-head">
          <b>{name}</b>
          <span className="mono ch-price">{last ? last.price.toFixed(last.price > 1000 ? 2 : 4) : '—'}</span>
          {last && <span className={`mono ${last.change >= 0 ? 'up' : 'down'}`}>{last.change >= 0 ? '▲' : '▼'} {Math.abs(last.change).toFixed(3)}%</span>}
          <span className="hint" style={{ marginLeft: 'auto' }}>{mode === 'ticks' ? 'Every tick, live' : `${FRAMES.find((f) => f.g === gran)?.l} candles, live`}</span>
        </div>
        <div className="ch-plot" ref={box}>
          {loading && <div className="ch-loading"><span className="spinner" /> Loading from Deriv…</div>}
          {error && <div className="ch-loading error">{error}</div>}
        </div>
      </section>
    </div>
  );
}
