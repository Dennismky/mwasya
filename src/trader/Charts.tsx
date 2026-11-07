import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, createChart,
  type IChartApi, type ISeriesApi, type MouseEventParams, type SeriesType, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import { publicSocket } from '../lib/derivWs';
import { useTrader } from './TraderApp';
import { SYMBOLS, decimalsOf, lastDigit, useTicks } from './ticks';
import { CATEGORIES, INDICATORS, byId, type Bar, type Category } from './indicators';
import { useMarket } from './market';
import { fitScale } from '../lib/fit';

type Mode = 'ticks' | 'candles';
type Pop = 'type' | 'frame' | null;
type Modal = 'ind' | 'tpl' | 'draw' | null;
type DrawKind = 'hline' | 'vline' | 'trend';
interface Drawing { id: number; kind: DrawKind; t1: number; p1: number; t2?: number; p2?: number }
interface Template { name: string; mode: Mode; gran: number; inds: string[] }

const FRAMES = [
  { g: 60, l: '1m', n: '1 minute' }, { g: 120, l: '2m', n: '2 minutes' }, { g: 300, l: '5m', n: '5 minutes' }, { g: 900, l: '15m', n: '15 minutes' },
  { g: 1800, l: '30m', n: '30 minutes' }, { g: 3600, l: '1h', n: '1 hour' }, { g: 14400, l: '4h', n: '4 hours' }, { g: 86400, l: '1D', n: '1 day' },
];
const DRAW_TOOLS: { kind: DrawKind; name: string; hint: string }[] = [
  { kind: 'hline', name: 'Horizontal line', hint: 'Click a price level' },
  { kind: 'trend', name: 'Trend line', hint: 'Click the start, then the end' },
  { kind: 'vline', name: 'Vertical line', hint: 'Click a moment in time' },
];
const CAT_ICON: Record<Category | 'Active', string> = { Active: '⚡', Momentum: '⇗', Trend: '⤳', Volatility: '≋', 'Moving averages': '∩', Others: '⋯' };
const KEY_TPL = 'mw_chart_templates';
const KEY_INDS = 'mw_chart_inds';

/* Theme colours, chosen so prices, numbers and labels read clearly in both modes. */
// EDIT HERE: chart colours for light and dark mode (background, grid, up/down candles, line).
const THEME = {
  light: { text: '#3A4860', grid: 'rgba(11,31,58,.05)', up: '#0E9F6E', down: '#E0393E', line: '#1F4FD1', bg: '#F7F9FC', draw: '#1F4FD1' },
  dark: { text: '#D7E0EE', grid: 'rgba(255,255,255,.07)', up: '#2BD4A0', down: '#FF6B6F', line: '#7FA2FF', bg: '#0E1A2E', draw: '#7FA2FF' },
};

const t = (s: number) => s as UTCTimestamp;
/** Price with exactly the market's decimals, so the last digit always shows (V100 1s: 2, V10: 3, V50: 4). */
const fmtD = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
// EDIT HERE: how much older history loads each time the client drags the chart to the left, and the most kept in memory.
/** Chart text follows the site's scale (the chart itself stays at true size for accurate mouse positions). */
const chartFont = () => Math.max(10, Math.round(12 * fitScale()));
const OLDER_CANDLES = 1000, OLDER_TICKS = 2000, MAX_BARS = 40_000;

/** A trade line drawn across the chart (entry, barrier, range…). Colour may be a CSS value such as "var(--primary)". */
export interface TradeLine { value: number; label: string; color: string; dashed?: boolean }

/** Any CSS colour as #rrggbb (the chart library cannot read var() or color-mix()). */
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const toHex = (el: HTMLElement, css: string, fallback = '#1F4FD1') => {
  const m = css.match(/^var\((--[\w-]+)\)$/);
  const v = m ? getComputedStyle(el).getPropertyValue(m[1]).trim() : css;
  if (!probe || !v) return fallback;
  probe.fillStyle = fallback; probe.fillStyle = v;
  return /^#[0-9a-f]{6}$/i.test(String(probe.fillStyle)) ? String(probe.fillStyle) : fallback;
};
const loadJson = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };

/** Charts tab: the full chart on its own. */
export default function Charts() {
  return <ChartView />;
}

/**
 * Live Deriv chart: ticks or candles, time frames, indicators (by category, with search and templates),
 * drawing tools, OHLC readout, zoom, and a price tag with the candle countdown.
 * Used by the Charts tab and by Manual Trader (which passes its market and trade lines).
 */
/** A price with its last digit underlined (the digit digit-contracts settle on). */
function Px({ text }: { text: string }) {
  return <>{text.slice(0, -1)}<u className="px-last">{text.slice(-1)}</u></>;
}

export function ChartView({ symbol: extSymbol, onSymbol, lines = [], defaultMode = 'candles' }: {
  symbol?: string; onSymbol?: (s: string) => void; lines?: TradeLine[]; defaultMode?: Mode;
}) {
  const { dark } = useTrader();
  const theme = dark ? THEME.dark : THEME.light;
  const [ownSymbol, setOwnSymbol] = useMarket(); // the site-wide market
  const symbol = extSymbol ?? ownSymbol;
  const setSymbol = onSymbol ?? setOwnSymbol;
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [gran, setGran] = useState(60);
  const [inds, setInds] = useState<string[]>(() => loadJson<string[]>(KEY_INDS, ['sma']).filter((i) => byId(i)));
  const [pop, setPop] = useState<Pop>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [cat, setCat] = useState<Category | 'Active'>('Active');
  const [q, setQ] = useState('');
  const [templates, setTemplates] = useState<Template[]>(() => loadJson<Template[]>(KEY_TPL, []));
  const [tplName, setTplName] = useState('');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [placing, setPlacing] = useState<{ kind: DrawKind; first?: { t: number; p: number } } | null>(null);
  const [last, setLast] = useState<{ price: number; change: number; up: boolean } | null>(null);
  const [tag, setTag] = useState<{ y: number; left: number } | null>(null);
  const [ohlc, setOhlc] = useState<{ o: number; h: number; l: number; c: number; time: number; x: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState<'loading' | 'end' | null>(null);
  const [dec, setDec] = useState(2);
  const fmt = (v: number) => fmtD(v, dec);
  // Last-digit distribution over the last 1000 ticks (works in both ticks and candles mode).
  const [showDigits, setShowDigits] = useState(() => localStorage.getItem('mw_chart_digits') !== '0');
  const { prices: tickPrices } = useTicks(symbol, 1000);
  const digitStats = (() => {
    if (tickPrices.length < 20) return null;
    const dec = decimalsOf(tickPrices);
    const count = Array(10).fill(0) as number[];
    for (const p of tickPrices) count[lastDigit(p, dec)]++;
    const pct = count.map((c) => (c / tickPrices.length) * 100);
    const max = Math.max(...pct), min = Math.min(...pct);
    return { pct, max, min, live: lastDigit(tickPrices[tickPrices.length - 1], dec), n: tickPrices.length };
  })();
  const [, setFrame] = useState(0); // re-render drawings when the view moves
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const openTime = useRef(0);
  const indRef = useRef(inds);
  indRef.current = inds;
  const redrawRef = useRef<() => void>(() => undefined);
  // Which indicator each drawn line belongs to, so a click on a line can find it, and each indicator's colour for its chip.
  const seriesInd = useRef(new Map<ISeriesApi<SeriesType>, string>());
  const indColour = useRef(new Map<string, string>());
  const [picked, setPicked] = useState<{ id: string; x: number; y: number } | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 }); // where the cursor last pressed, inside the chart area

  useEffect(() => { localStorage.setItem(KEY_INDS, JSON.stringify(inds)); }, [inds]);

  // Chart instance; rebuilt when the client switches light/dark so every colour matches.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: theme.bg }, textColor: theme.text, fontSize: chartFont(), fontFamily: 'Inter, system-ui, sans-serif', panes: { separatorColor: theme.grid } },
      grid: { vertLines: { color: theme.grid }, horzLines: { color: theme.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 8 },
    });
    chartRef.current = chart;
    const onFit = () => chart.applyOptions({ layout: { fontSize: chartFont() } });
    window.addEventListener('fitchange', onFit);
    return () => { window.removeEventListener('fitchange', onFit); chartRef.current = null; chart.remove(); };
  }, [dark]); // eslint-disable-line react-hooks/exhaustive-deps

  // Data: history + live stream from Deriv's public feed.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setLoading(true); setError(''); setLast(null); setTag(null); setOhlc(null); setOlder(null);
    const main: ISeriesApi<SeriesType> = mode === 'candles'
      ? chart.addSeries(CandlestickSeries, { upColor: theme.up, downColor: theme.down, borderVisible: false, wickUpColor: theme.up, wickDownColor: theme.down, lastValueVisible: false })
      : chart.addSeries(AreaSeries, { lineColor: theme.line, topColor: `${theme.line}55`, bottomColor: `${theme.line}05`, lineWidth: 2, lastValueVisible: false });
    mainRef.current = main;
    chart.timeScale().applyOptions({ secondsVisible: mode === 'ticks' || gran < 300 });

    let bars: Bar[] = [];
    let extra: ISeriesApi<SeriesType>[] = [];
    let first = 0;
    const placeTag = (price: number) => {
      const y = main.priceToCoordinate(price);
      const w = chart.priceScale('right').width();
      if (y !== null && box.current) setTag({ y, left: box.current.clientWidth - w });
    };
    // Indicators: overlays on the price pane, each oscillator in its own pane below.
    const redraw = () => {
      if (chartRef.current !== chart) return;
      extra.forEach((s) => { try { chart.removeSeries(s); } catch { /* gone */ } }); extra = [];
      seriesInd.current.clear();
      for (let i = chart.panes().length - 1; i > 0; i--) { try { chart.removePane(i); } catch { /* gone */ } }
      let pane = 0;
      for (const id of indRef.current) {
        const def = byId(id);
        if (!def) continue;
        const out = def.run(bars);
        if (out.plots[0]?.color) indColour.current.set(id, out.plots[0].color);
        const target = def.place === 'pane' ? ++pane : 0;
        for (const pl of out.plots) {
          const common = { priceLineVisible: false, lastValueVisible: def.place === 'pane', crosshairMarkerVisible: false };
          const s = pl.kind === 'hist'
            ? chart.addSeries(HistogramSeries, { ...common, color: pl.color }, target)
            : chart.addSeries(LineSeries, { ...common, color: pl.color, lineWidth: pl.width ?? 2, lineVisible: pl.kind !== 'dots', pointMarkersVisible: pl.kind === 'dots', pointMarkersRadius: 2 }, target);
          s.setData(pl.data.map((p) => ({ time: t(p.time), value: p.value, ...(p.color ? { color: p.color } : {}) })));
          extra.push(s);
          seriesInd.current.set(s, id);
        }
        const host = extra[extra.length - 1];
        if (host && out.levels) for (const lv of out.levels) host.createPriceLine({ price: lv, color: theme.grid.replace(/[\d.]+\)$/, '.35)'), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      }
      chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(110); });
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
    const show = () => {
      if (mode === 'candles') main.setData(bars.map((b) => ({ ...b, time: t(b.time) })));
      else main.setData(bars.map((b) => ({ time: t(b.time), value: b.close })));
    };
    // Price axis and labels use the market's own decimals.
    const setDecimals = () => {
      const d = Math.max(decimalsOf(bars.slice(-200).flatMap((b) => [b.open, b.close])), 2);
      main.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / 10 ** d } });
      setDec(d);
    };
    const toBars = (m: Record<string, unknown>): Bar[] => m.candles
      ? (m.candles as (Bar & { epoch: number })[]).map((c) => ({ time: Number(c.epoch), open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
      : (() => { const h = (m.history ?? { prices: [], times: [] }) as { prices: number[]; times: number[] }; return h.times.map((tm, i) => ({ time: tm, open: +h.prices[i], high: +h.prices[i], low: +h.prices[i], close: +h.prices[i] })); })();
    // Dragging to the left loads older prices from Deriv, page by page (back to previous days), keeping the view still.
    let fetchingOlder = false, noMore = false;
    const loadOlder = async () => {
      if (fetchingOlder || noMore || !bars.length) return;
      if (bars.length >= MAX_BARS) { noMore = true; setOlder('end'); return; }
      fetchingOlder = true; setOlder('loading');
      try {
        const end = bars[0].time - 1;
        const r = await ws.send<Record<string, unknown>>(mode === 'candles'
          ? { ticks_history: symbol, style: 'candles', granularity: gran, count: OLDER_CANDLES, end }
          : { ticks_history: symbol, style: 'ticks', count: OLDER_TICKS, end });
        if (!alive || chartRef.current !== chart) return;
        const fresh = toBars(r).filter((b) => b.time < bars[0].time);
        if (!fresh.length) { noMore = true; setOlder('end'); return; }
        const ts = chart.timeScale(), range = ts.getVisibleLogicalRange();
        bars = [...fresh, ...bars];
        show(); redraw();
        if (range) ts.setVisibleLogicalRange({ from: range.from + fresh.length, to: range.to + fresh.length });
        setOlder(null);
      } catch { if (alive) setOlder(null); } finally { fetchingOlder = false; }
    };

    ws.subscribe(req, (m) => {
      if (!alive) return;
      const err = m.error as { message?: string } | undefined;
      if (err) { setError(err.message ?? 'Could not load the chart.'); setLoading(false); return; }
      if (m.candles) {
        bars = toBars(m);
        show(); setDecimals(); openTime.current = bars[bars.length - 1]?.time ?? 0;
        first = bars[0]?.open ?? 0; redraw(); chart.timeScale().fitContent(); setLoading(false);
        report(bars[bars.length - 1]?.close ?? 0);
      } else if (m.history) {
        bars = toBars(m);
        show(); setDecimals(); first = bars[0]?.close ?? 0; redraw(); chart.timeScale().fitContent(); setLoading(false);
        report(bars[bars.length - 1]?.close ?? 0);
      } else if (m.ohlc) {
        const o = m.ohlc as Record<string, string | number>;
        const c: Bar = { time: Number(o.open_time), open: +o.open, high: +o.high, low: +o.low, close: +o.close };
        const prev = bars[bars.length - 1]?.close;
        if (bars.length && bars[bars.length - 1].time === c.time) bars[bars.length - 1] = c; else bars.push(c);
        openTime.current = c.time;
        main.update({ ...c, time: t(c.time) }); report(c.close, prev);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      } else if (m.tick) {
        const k = m.tick as { epoch: number; quote: number };
        if (bars.length && bars[bars.length - 1].time >= k.epoch) return;
        const prev = bars[bars.length - 1]?.close;
        bars.push({ time: k.epoch, open: +k.quote, high: +k.quote, low: +k.quote, close: +k.quote }); if (bars.length > MAX_BARS) bars.shift();
        main.update({ time: t(k.epoch), value: +k.quote }); report(+k.quote, prev);
        if (Date.now() - lastRedraw > 1000) { lastRedraw = Date.now(); redraw(); }
      }
    }).then((u) => { stop = u; if (!alive) u(); }).catch((e: Error) => { setError(e.message); setLoading(false); });

    // Keep the price tag and drawings glued to the chart while zooming or scrolling.
    const onRange = () => {
      const v = bars[bars.length - 1]?.close; if (v !== undefined) placeTag(v); setFrame((f) => f + 1);
      const r = chart.timeScale().getVisibleLogicalRange();
      if (r && r.from < 40) void loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    // OHLC readout under the cursor.
    const onMove = (p: MouseEventParams<Time>) => {
      const d = p.seriesData.get(main) as { open?: number; high?: number; low?: number; close?: number; value?: number } | undefined;
      if (!d || p.time === undefined || !p.point) { setOhlc(null); return; }
      const c = d.close ?? d.value ?? 0;
      setOhlc({ o: d.open ?? c, h: d.high ?? c, l: d.low ?? c, c, time: Number(p.time), x: p.point.x });
    };
    chart.subscribeCrosshairMove(onMove);
    // Click an indicator's line: a small box offers Delete. A click anywhere else closes it.
    const onChartClick = (p: MouseEventParams<Time>) => {
      let id = p.hoveredSeries ? seriesInd.current.get(p.hoveredSeries) : undefined;
      if (!id && p.point) {
        // Lines are thin and redrawn every second, so also accept a click close to one (EDIT HERE: distance in pixels).
        let nearest = 8;
        for (const [series, ind] of seriesInd.current) {
          if (p.paneIndex !== undefined && series.getPane().paneIndex() !== p.paneIndex) continue;
          const value = (p.seriesData.get(series) as { value?: number } | undefined)?.value;
          const y = value === undefined ? null : series.priceToCoordinate(value);
          if (y !== null && Math.abs(y - p.point.y) < nearest) { nearest = Math.abs(y - p.point.y); id = ind; }
        }
      }
      if (!id || !p.point || !box.current) { setPicked(null); return; }
      setPicked({ id, ...lastPointer.current });
    };
    chart.subscribeClick(onChartClick);

    return () => {
      alive = false; stop?.(); ws.close();
      if (chartRef.current === chart) {
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); chart.unsubscribeCrosshairMove(onMove); chart.unsubscribeClick(onChartClick);
          extra.forEach((s) => chart.removeSeries(s)); chart.removeSeries(main);
          for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);
        } catch { /* chart already gone */ }
      }
      mainRef.current = null;
    };
  }, [symbol, mode, gran, dark]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { redrawRef.current(); }, [inds]);

  // Trade lines from the page (Manual Trader: entry, barrier, accumulator range). Redrawn on any change.
  const linesKey = lines.map((l) => `${l.label}:${l.value}:${l.color}`).join('|');
  useEffect(() => {
    const s = mainRef.current, el = box.current;
    if (!s || !el || !lines.length) return;
    const made = lines.map((l) => s.createPriceLine({ price: l.value, color: toHex(el, l.color), lineWidth: 1, lineStyle: l.dashed ? 2 : 0, axisLabelVisible: true, title: l.label }));
    return () => { try { made.forEach((p) => s.removePriceLine(p)); } catch { /* series already replaced */ } };
  }, [linesKey, symbol, mode, gran, dark, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown to the current candle's close (also refreshes drawings once a second).
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
  const toggleInd = (id: string) => setInds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const removeInd = (id: string) => { setInds((xs) => xs.filter((x) => x !== id)); setPicked(null); };

  // Templates: save / apply / delete the current chart setup.
  const saveTpl = () => {
    const name = tplName.trim().slice(0, 30) || `Template ${templates.length + 1}`;
    const next = [...templates.filter((x) => x.name !== name), { name, mode, gran, inds }];
    setTemplates(next); localStorage.setItem(KEY_TPL, JSON.stringify(next)); setTplName('');
  };
  const applyTpl = (x: Template) => { setMode(x.mode); setGran(x.gran); setInds(x.inds.filter((i) => byId(i))); setModal(null); };
  const delTpl = (name: string) => { const next = templates.filter((x) => x.name !== name); setTemplates(next); localStorage.setItem(KEY_TPL, JSON.stringify(next)); };

  // Drawing: click on the chart to place points (converted to time/price so lines follow zoom and scroll).
  const placeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const chart = chartRef.current, s = mainRef.current;
    if (!placing || !chart || !s) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const time = chart.timeScale().coordinateToTime(x), price = s.coordinateToPrice(y);
    if (time === null || price === null) return;
    const tp = { t: Number(time), p: Number(price) };
    if (placing.kind === 'trend' && !placing.first) { setPlacing({ kind: 'trend', first: tp }); return; }
    const d: Drawing = placing.kind === 'trend'
      ? { id: Date.now(), kind: 'trend', t1: placing.first!.t, p1: placing.first!.p, t2: tp.t, p2: tp.p }
      : { id: Date.now(), kind: placing.kind, t1: tp.t, p1: tp.p };
    setDrawings((xs) => [...xs, d]); setPlacing(null);
  };
  const svg = (() => {
    const chart = chartRef.current, s = mainRef.current, el = box.current;
    if (!chart || !s || !el) return null;
    const W = el.clientWidth - chart.priceScale('right').width(), H = el.clientHeight;
    return drawings.map((d) => {
      const x1 = chart.timeScale().timeToCoordinate(t(d.t1)), y1 = s.priceToCoordinate(d.p1);
      if (d.kind === 'hline' && y1 !== null) return <line key={d.id} x1={0} x2={W} y1={y1} y2={y1} />;
      if (d.kind === 'vline' && x1 !== null) return <line key={d.id} x1={x1} x2={x1} y1={0} y2={H} />;
      if (d.kind === 'trend' && x1 !== null && y1 !== null && d.t2 !== undefined && d.p2 !== undefined) {
        const x2 = chart.timeScale().timeToCoordinate(t(d.t2)), y2 = s.priceToCoordinate(d.p2);
        if (x2 !== null && y2 !== null) return <g key={d.id}><line x1={x1} y1={y1} x2={x2} y2={y2} /><circle cx={x1} cy={y1} r={3} /><circle cx={x2} cy={y2} r={3} /></g>;
      }
      return null;
    });
  })(); // recomputed every render (view changes trigger renders)

  const frame = FRAMES.find((f) => f.g === gran);
  const list = q.trim()
    ? INDICATORS.filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()))
    : cat === 'Active' ? INDICATORS.filter((i) => inds.includes(i.id)) : INDICATORS.filter((i) => i.category === cat);
  const ohlcPct = ohlc && ohlc.o ? ((ohlc.c - ohlc.o) / ohlc.o) * 100 : 0;

  return (
    <div className={`dc2 ${dark ? 'dark' : 'light'}`} onClick={() => setPop(null)}>
      <div className="dc2-plot" ref={box} onPointerDownCapture={(e) => { const r = e.currentTarget.getBoundingClientRect(); lastPointer.current = { x: e.clientX - r.left, y: e.clientY - r.top }; }}>
        {loading && <div className="ch-loading"><span className="spinner" /> Loading from Deriv…</div>}
        {error && <div className="ch-loading error">{error}</div>}
        {tag && last && (
          <div className={`dc2-tag ${last.up ? 'up' : 'down'}`} style={{ top: tag.y, left: tag.left }}>
            <b className="mono"><Px text={fmt(last.price)} /></b>{countdown && <small className="mono">{countdown}</small>}
          </div>
        )}
        <svg className="dc2-draw" style={{ color: theme.draw }} aria-hidden="true">{svg}</svg>
        {placing && <div className="dc2-catch" onClick={placeClick} />}
        {/* EDIT HERE: indicator chips on the chart (name + ✕ to remove). */}
        {inds.length > 0 && (
          <div className="dc2-legend" onClick={(e) => e.stopPropagation()}>
            {inds.map((id) => (
              <span key={id} className="dc2-chip">
                <i style={{ background: indColour.current.get(id) ?? 'currentColor' }} />
                <button className="dc2-chip-name" title="Show options" onClick={(e) => { const b = box.current?.getBoundingClientRect(), r = e.currentTarget.getBoundingClientRect(); setPicked({ id, x: r.left - (b?.left ?? 0), y: r.top - (b?.top ?? 0) - 46 }); }}>{byId(id)?.name ?? id}</button>
                <button className="dc2-chip-x" aria-label={`Remove ${byId(id)?.name ?? id}`} title="Remove" onClick={() => removeInd(id)}>✕</button>
              </span>
            ))}
          </div>
        )}
        {picked && inds.includes(picked.id) && (
          // EDIT HERE: the box opens just beside the cursor (6 px away), and stays inside the chart at the edges.
          <div className="dc2-picked" role="dialog" aria-label="Indicator" style={{ left: Math.max(8, Math.min(picked.x + 6, (box.current?.clientWidth ?? 600) - 300)), top: Math.max(8, Math.min(picked.y + 6, (box.current?.clientHeight ?? 400) - 48)) }} onClick={(e) => e.stopPropagation()}>
            <b>{byId(picked.id)?.name ?? picked.id}</b>
            <button className="dc2-picked-del" aria-label={`Delete ${byId(picked.id)?.name ?? picked.id}`} title="Delete" onClick={() => removeInd(picked.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg>
            </button>
          </div>
        )}
        {older === 'loading' && <div className="dc2-older"><span className="spinner" /> Loading older prices…</div>}
        {older === 'end' && <div className="dc2-older">Start of the loaded history</div>}
        {ohlc && !picked && mode === 'ticks' && (
          <div className="dc2-ohlc dc2-tickread" style={{ left: Math.max(70, Math.min(ohlc.x - 64, (box.current?.clientWidth ?? 600) - 200)) }}>
            <span>Price</span><i className="mono"><Px text={fmt(ohlc.c)} /></i>
            <span>Last digit</span><i className="mono">{fmt(ohlc.c).slice(-1)}</i>
            <small>{new Date(ohlc.time * 1000).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })} GMT</small>
          </div>
        )}
        {ohlc && !picked && mode === 'candles' && (
          <div className="dc2-ohlc" style={{ left: Math.max(70, Math.min(ohlc.x - 64, (box.current?.clientWidth ?? 600) - 200)) }}>
            <b className={ohlcPct >= 0 ? 'up' : 'down'}>{ohlcPct >= 0 ? '+' : ''}{ohlcPct.toFixed(2)}%</b>
            <span>Open</span><i className="mono">{fmt(ohlc.o)}</i>
            <span>High</span><i className="mono">{fmt(ohlc.h)}</i>
            <span>Low</span><i className="mono">{fmt(ohlc.l)}</i>
            <span>Close</span><i className="mono">{fmt(ohlc.c)}</i>
            <small>{new Date(ohlc.time * 1000).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} GMT</small>
          </div>
        )}
      </div>

      {placing && (
        <div className="dc2-placing">
          {DRAW_TOOLS.find((d) => d.kind === placing.kind)?.hint}{placing.first ? ' — now click the end' : ''}
          <button onClick={() => setPlacing(null)}>Cancel</button>
        </div>
      )}

      {showDigits && digitStats && (
        <div className="dc2-digits" onClick={(e) => e.stopPropagation()} title={`Last digits of the last ${digitStats.n} ticks`}>
          {digitStats.pct.map((p, d) => (
            <span key={d} className={`${p === digitStats.max ? 'hot' : p === digitStats.min ? 'cold' : ''} ${digitStats.live === d ? 'live' : ''}`}>
              <b>{d}</b><small className="mono">{p.toFixed(1)}%</small>
            </span>
          ))}
          <button aria-label="Hide digit distribution" onClick={() => { setShowDigits(false); localStorage.setItem('mw_chart_digits', '0'); }}>✕</button>
        </div>
      )}
      {!showDigits && <button className="dc2-digits-show" onClick={(e) => { e.stopPropagation(); setShowDigits(true); localStorage.setItem('mw_chart_digits', '1'); }}>0–9 %</button>}

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
        <button className={`${modal === 'ind' ? 'on' : ''} ${inds.length ? 'has' : ''}`} title="Indicators" onClick={() => { setModal('ind'); setQ(''); setCat(inds.length ? 'Active' : 'Momentum'); }}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 20h18M5 16l4-5 4 3 6-8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          {inds.length > 0 && <i>{inds.length}</i>}
        </button>
        <button className={modal === 'tpl' ? 'on' : ''} title="Templates" onClick={() => setModal('tpl')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3 9h18M9 9v11" stroke="currentColor" strokeWidth="1.7" /></svg>
        </button>
        <button className={`${modal === 'draw' || placing ? 'on' : ''} ${drawings.length ? 'has' : ''}`} title="Drawing tools" onClick={() => setModal('draw')}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
          {drawings.length > 0 && <i>{drawings.length}</i>}
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
      </nav>

      <div className="dc2-zoom" onClick={(e) => e.stopPropagation()}>
        <button title="Zoom in" onClick={() => zoom(0.7)}>+</button>
        <button title="Back to now" onClick={() => { const ts = chartRef.current?.timeScale(); if (!ts) return; ts.resetTimeScale(); ts.scrollToRealTime(); }}>◎</button>
        <button title="Zoom out" onClick={() => zoom(1.4)}>−</button>
      </div>

      {modal && (
        <div className="cm-wrap" onClick={() => setModal(null)}>
          {modal === 'ind' && (
            <section className="cm cm-split" role="dialog" aria-label="Indicators" onClick={(e) => e.stopPropagation()}>
              <aside className="cm-side">
                <h3>Indicators</h3>
                {(['Active', ...CATEGORIES] as const).map((c) => (
                  <button key={c} className={!q && cat === c ? 'on' : ''} onClick={() => { setCat(c); setQ(''); }}>
                    <span aria-hidden="true">{CAT_ICON[c]}</span>{c}{c === 'Active' && inds.length > 0 && <em>{inds.length}</em>}
                  </button>
                ))}
              </aside>
              <div className="cm-main">
                <div className="cm-top">
                  <label className="cm-search"><span aria-hidden="true">⌕</span><input placeholder="Search indicators" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></label>
                  <button className="cm-x" aria-label="Close" onClick={() => setModal(null)}>✕</button>
                </div>
                <div className="cm-list">
                  {list.length === 0 ? (
                    <div className="cm-empty"><span aria-hidden="true">◫</span>{cat === 'Active' && !q ? 'You have no active indicators yet.' : 'No indicators match.'}</div>
                  ) : list.map((i) => {
                    const on = inds.includes(i.id);
                    return (
                      <button key={i.id} className={`cm-item ${on ? 'on' : ''}`} onClick={() => toggleInd(i.id)}>
                        <span className="cm-ic" aria-hidden="true">{i.icon}</span>
                        <span className="cm-name">{i.name}<small>{i.place === 'pane' ? 'Own panel' : 'On price'}</small></span>
                        <span className="cm-act">{on ? '✓ Added' : '+ Add'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
          {modal === 'tpl' && (
            <section className="cm cm-small" role="dialog" aria-label="Templates" onClick={(e) => e.stopPropagation()}>
              <div className="cm-top"><h3>Templates</h3><button className="cm-x" aria-label="Close" onClick={() => setModal(null)}>✕</button></div>
              <div className="cm-list">
                {templates.length === 0 && <div className="cm-empty"><span aria-hidden="true">◫</span>You have no saved templates yet.</div>}
                {templates.map((x) => (
                  <div key={x.name} className="cm-tpl">
                    <button className="cm-tpl-main" onClick={() => applyTpl(x)}><b>{x.name}</b><small>{x.mode === 'candles' ? `Candles · ${FRAMES.find((f) => f.g === x.gran)?.l}` : 'Ticks'} · {x.inds.length} indicator{x.inds.length === 1 ? '' : 's'}</small></button>
                    <button className="cm-del" aria-label={`Delete ${x.name}`} onClick={() => delTpl(x.name)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="cm-save">
                <input placeholder="Name this setup, e.g. Scalping 1m" value={tplName} maxLength={30} onChange={(e) => setTplName(e.target.value)} />
                <button onClick={saveTpl}>+ Add new template</button>
              </div>
            </section>
          )}
          {modal === 'draw' && (
            <section className="cm cm-split" role="dialog" aria-label="Drawing tools" onClick={(e) => e.stopPropagation()}>
              <aside className="cm-side">
                <h3>Drawing tools</h3>
                <button className="on" disabled><span aria-hidden="true">✎</span>All drawings{drawings.length > 0 && <em>{drawings.length}</em>}</button>
              </aside>
              <div className="cm-main">
                <div className="cm-top"><b>Pick a tool, then click on the chart</b><button className="cm-x" aria-label="Close" onClick={() => setModal(null)}>✕</button></div>
                <div className="cm-list">
                  {DRAW_TOOLS.map((d) => (
                    <button key={d.kind} className="cm-item" onClick={() => { setPlacing({ kind: d.kind }); setModal(null); }}>
                      <span className={`cm-ic dt-${d.kind}`} aria-hidden="true" /><span className="cm-name">{d.name}<small>{d.hint}</small></span><span className="cm-act">Draw</span>
                    </button>
                  ))}
                  {drawings.length > 0 && (
                    <div className="cm-active">
                      <b>On the chart</b>
                      {drawings.map((d) => (
                        <div key={d.id} className="cm-tpl">
                          <span className="cm-tpl-main"><b>{DRAW_TOOLS.find((x) => x.kind === d.kind)?.name}</b><small className="mono">{d.kind === 'vline' ? `${new Date(d.t1 * 1000).toLocaleTimeString(undefined, { timeZone: 'UTC' })} GMT` : fmt(d.p1)}</small></span>
                          <button className="cm-del" aria-label="Remove drawing" onClick={() => setDrawings((xs) => xs.filter((x) => x.id !== d.id))}>✕</button>
                        </div>
                      ))}
                      <button className="cm-clear" onClick={() => setDrawings([])}>Remove all drawings</button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
