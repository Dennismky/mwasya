import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, LineSeries, createChart,
  type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp,
} from 'lightweight-charts';
import { publicSocket } from '../lib/derivWs';
import { useTrader } from './TraderApp';
import { SYMBOLS } from './ticks';

type Mode = 'ticks' | 'candles';
type Ind = 'sma' | 'ema' | 'bb' | 'rsi';
type Pop = 'type' | 'frame' | 'ind' | null;
interface Candle { time: number; open: number; high: number; low: number; close: number }
interface Pt { time: number; value: number }

const FRAMES = [
  { g: 60, l: '1m', n: '1 minute' }, { g: 120, l: '2m', n: '2 minutes' }, { g: 300, l: '5m', n: '5 minutes' }, { g: 900, l: '15m', n: '15 minutes' },
  { g: 1800, l: '30m', n: '30 minutes' }, { g: 3600, l: '1h', n: '1 hour' }, { g: 14400, l: '4h', n: '4 hours' }, { g: 86400, l: '1D', n: '1 day' },
];
const INDICATORS: { id: Ind; label: string; color: string }[] = [
  { id: 'sma', label: 'Moving average (20)', color: '#F5A524' },
  { id: 'ema', label: 'Exponential MA (50)', color: '#A855F7' },
  { id: 'bb', label: 'Bollinger bands (20)', color: '#22B8CF' },
  { id: 'rsi', label: 'RSI (14)', color: '#E5484D' },
];

/* Theme colours, chosen so prices, numbers and labels read clearly in both modes. */
// EDIT HERE: chart colours for light and dark mode (background, grid, up/down candles, line).
const THEME = {
  light: { text: '#3A4860', grid: 'rgba(11,31,58,.05)', up: '#0E9F6E', down: '#E0393E', line: '#1F4FD1', bg: '#F7F9FC' },
  dark: { text: '#D7E0EE', grid: 'rgba(255,255,255,.07)', up: '#2BD4A0', down: '#FF6B6F', line: '#7FA2FF', bg: '#0E1A2E' },
};

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
const t = (s: number) => s as UTCTimestamp;
const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: v > 1000 ? 2 : 3, maximumFractionDigits: v > 1000 ? 2 : 3 });

/** Live Deriv chart: ticks or candles, time frames, indicators, zoom, and a countdown to the candle close. */
export default function Charts() {
  const { dark } = useTrader();
  const theme = dark ? THEME.dark : THEME.light;
  const [symbol, setSymbol] = useState('1HZ100V');
  const [mode, setMode] = useState<Mode>('candles');
  const [gran, setGran] = useState(60);
  const [inds, setInds] = useState<Ind[]>(['sma']);
  const [pop, setPop] = useState<Pop>(null);
  const [last, setLast] = useState<{ price: number; change: number; up: boolean } | null>(null);
  const [tag, setTag] = useState<{ y: number; left: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const openTime = useRef(0);
  const indRef = useRef(inds);
  indRef.current = inds;
  const redrawRef = useRef<() => void>(() => undefined);

  // Chart instance; rebuilt when the client switches light/dark so every colour matches.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: theme.bg }, textColor: theme.text, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif', panes: { separatorColor: theme.grid } },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 8 },
    });
    chartRef.current = chart;
    return () => { chartRef.current = null; chart.remove(); };
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data: history + live stream from Deriv's public feed.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setLoading(true); setError(''); setLast(null); setTag(null);
    let main: ISeriesApi<SeriesType>;
    if (mode === 'candles') main = chart.addSeries(CandlestickSeries, { upColor: theme.up, downColor: theme.down, borderVisible: false, wickUpColor: theme.up, wickDownColor: theme.down, lastValueVisible: false });
    else main = chart.addSeries(AreaSeries, { lineColor: theme.line, topColor: `${theme.line}55`, bottomColor: `${theme.line}05`, lineWidth: 2, lastValueVisible: false });
    chart.timeScale().applyOptions({ secondsVisible: mode === 'ticks' || gran < 300 });

    let candles: Candle[] = [];
    let ticks: Pt[] = [];
    let extra: ISeriesApi<SeriesType>[] = [];
    let first = 0;
    const closes = (): Pt[] => (mode === 'candles' ? candles.map((c) => ({ time: c.time, value: c.close })) : ticks);
    const placeTag = (price: number) => {
      const y = main.priceToCoordinate(price);
      const w = chart.priceScale('right').width();
      if (y !== null && box.current) setTag({ y, left: box.current.clientWidth - w });
    };
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
        r.createPriceLine({ price: 70, color: 'rgba(229,72,77,.55)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        r.createPriceLine({ price: 30, color: 'rgba(18,160,122,.65)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        chart.panes()[1]?.setHeight(120);
      }
    };
    redrawRef.current = redraw;

    const ws = publicSocket();
    let stop: (() => void) | undefined;
    let alive = true;
    let lastRedraw = 0;
    const report = (price: number, prev?: number) => {
      if (!first) first = price;
      setLast({ price, change: ((price - first) / first) * 100, up: prev === undefined ? price >= first : price >= prev });
      placeTag(price);
    };
    const req = mode === 'candles'
      ? { ticks_history: symbol, style: 'candles', granularity: gran, count: 500, end: 'latest' }
      : { ticks_history: symbol, style: 'ticks', count: 1000, end: 'latest' };

    ws.subscribe(req, (m) => {
      if (!alive) return;
      const err = m.error as { message?: string } | undefined;
      if (err) { setError(err.message ?? 'Could not load the chart.'); setLoading(false); return; }
      if (m.candles) {
        candles = (m.candles as (Candle & { epoch: number })[]).map((c) => ({ time: Number(c.epoch), open: +c.open, high: +c.high, low: +c.low, close: +c.close }));
        main.setData(candles.map((c) => ({ ...c, time: t(c.time) })));
        openTime.current = candles[candles.length - 1]?.time ?? 0;
        first = candles[0]?.open ?? 0; redraw(); chart.timeScale().fitContent(); setLoading(false);
        report(candles[candles.length - 1]?.close ?? 0);
      } else if (m.history) {
        const h = m.history as { prices: number[]; times: number[] };
        ticks = h.times.map((tm, i) => ({ time: tm, value: +h.prices[i] }));
        main.setData(ticks.map((p) => ({ time: t(p.time), value: p.value })));
        first = ticks[0]?.value ?? 0; redraw(); chart.timeScale().fitContent(); setLoading(false);
        report(ticks[ticks.length - 1]?.value ?? 0);
      } else if (m.ohlc) {
        const o = m.ohlc as Record<string, string | number>;
        const c: Candle = { time: Number(o.open_time), open: +o.open, high: +o.high, low: +o.low, close: +o.close };
        const prev = candles[candles.length - 1]?.close;
        if (candles.length && candles[candles.length - 1].time === c.time) candles[candles.length - 1] = c; else candles.push(c);
        openTime.current = c.time;
        main.update({ ...c, time: t(c.time) }); report(c.close, prev);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      } else if (m.tick) {
        const k = m.tick as { epoch: number; quote: number };
        const p = { time: k.epoch, value: +k.quote };
        if (ticks.length && ticks[ticks.length - 1].time >= p.time) return;
        const prev = ticks[ticks.length - 1]?.value;
        ticks.push(p); if (ticks.length > 2000) ticks.shift();
        main.update({ time: t(p.time), value: p.value }); report(p.value, prev);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      }
    }).then((u) => { stop = u; if (!alive) u(); }).catch((e: Error) => { setError(e.message); setLoading(false); });

    // Keep the price tag glued to the axis while the client zooms or scrolls.
    const onRange = () => { const v = mode === 'candles' ? candles[candles.length - 1]?.close : ticks[ticks.length - 1]?.value; if (v !== undefined) placeTag(v); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      alive = false; stop?.(); ws.close();
      if (chartRef.current === chart) {
        try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); extra.forEach((s) => chart.removeSeries(s)); chart.removeSeries(main); } catch { /* chart already gone */ }
      }
    };
  }, [symbol, mode, gran, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { redrawRef.current(); }, [inds]);

  // Countdown to the current candle's close.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const left = mode === 'candles' && openTime.current ? Math.max(0, openTime.current + gran - Math.floor(now / 1000)) : null;
  const countdown = left === null ? '' : left >= 3600
    ? `${Math.floor(left / 3600)}:${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
    : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;

  const zoom = (f: number) => {
    const ts = chartRef.current?.timeScale(); const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const mid = (r.from + r.to) / 2, half = ((r.to - r.from) / 2) * f;
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half });
  };
  const shot = () => {
    const c = chartRef.current?.takeScreenshot(); if (!c) return;
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `${symbol}-${mode}.png`; a.click();
  };
  const toggle = (id: Ind) => setInds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const frame = FRAMES.find((f) => f.g === gran);

  return (
    <div className={`dc2 ${dark ? 'dark' : 'light'}`} onClick={() => setPop(null)}>
      <div className="dc2-plot" ref={box}>
        {loading && <div className="ch-loading"><span className="spinner" /> Loading from Deriv…</div>}
        {error && <div className="ch-loading error">{error}</div>}
        {tag && last && (
          <div className={`dc2-tag ${last.up ? 'up' : 'down'}`} style={{ top: tag.y, left: tag.left }}>
            <b className="mono">{fmt(last.price)}</b>{countdown && <small className="mono">{countdown}</small>}
          </div>
        )}
      </div>

      <div className="dc2-market" onClick={(e) => e.stopPropagation()}>
        <span className="dc2-mk-ic" aria-hidden="true">▤</span>
        <div className="dc2-mk-main">
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
            {[...new Set(SYMBOLS.map((s) => s.group))].map((g) => (
              <optgroup key={g} label={g}>{SYMBOLS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            ))}
          </select>
          <span className={`mono dc2-px ${last && last.change < 0 ? 'down' : 'up'}`}>
            {last ? fmt(last.price) : '—'} {last && <>{last.change >= 0 ? '▲' : '▼'} {Math.abs(last.change).toFixed(2)}%</>}
          </span>
        </div>
      </div>

      <nav className="dc2-tools" aria-label="Chart tools" onClick={(e) => e.stopPropagation()}>
        <button className={pop === 'type' ? 'on' : ''} title="Chart type" onClick={() => setPop(pop === 'type' ? null : 'type')}>
          {mode === 'candles'
            ? <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 3v18M17 5v14" stroke="currentColor" strokeWidth="1.6" /><rect x="4.5" y="7" width="5" height="9" rx="1" fill="currentColor" /><rect x="14.5" y="9" width="5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            : <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 17l5-6 4 3 4-7 5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>}
        </button>
        <button className={`dc2-frame ${pop === 'frame' ? 'on' : ''}`} title="Time frame" disabled={mode === 'ticks'} onClick={() => setPop(pop === 'frame' ? null : 'frame')}>{mode === 'ticks' ? '1T' : frame?.l}</button>
        <button className={`${pop === 'ind' ? 'on' : ''} ${inds.length ? 'has' : ''}`} title="Indicators" onClick={() => setPop(pop === 'ind' ? null : 'ind')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 20h18M5 16l4-5 4 3 6-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          {inds.length > 0 && <i>{inds.length}</i>}
        </button>
        <button title="Save picture" onClick={shot}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>

        {pop === 'type' && (
          <div className="dc2-pop">
            <b>Chart type</b>
            <button className={mode === 'ticks' ? 'on' : ''} onClick={() => { setMode('ticks'); setPop(null); }}>Area (every tick)</button>
            <button className={mode === 'candles' ? 'on' : ''} onClick={() => { setMode('candles'); setPop(null); }}>Candles</button>
          </div>
        )}
        {pop === 'frame' && (
          <div className="dc2-pop">
            <b>Time frame</b>
            {FRAMES.map((f) => <button key={f.g} className={gran === f.g ? 'on' : ''} onClick={() => { setGran(f.g); setPop(null); }}>{f.n}</button>)}
          </div>
        )}
        {pop === 'ind' && (
          <div className="dc2-pop">
            <b>Indicators</b>
            {INDICATORS.map((i) => (
              <label key={i.id} className="dc2-check" style={{ '--ic': i.color } as React.CSSProperties}>
                <input type="checkbox" checked={inds.includes(i.id)} onChange={() => toggle(i.id)} /><i />{i.label}
              </label>
            ))}
          </div>
        )}
      </nav>

      <div className="dc2-zoom" onClick={(e) => e.stopPropagation()}>
        <button title="Zoom in" onClick={() => zoom(0.7)}>+</button>
        <button title="Reset" onClick={() => chartRef.current?.timeScale().fitContent()}>◎</button>
        <button title="Zoom out" onClick={() => zoom(1.4)}>−</button>
      </div>
    </div>
  );
}
