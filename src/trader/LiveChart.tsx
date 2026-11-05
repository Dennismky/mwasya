import { useEffect, useRef } from 'react';
import { AreaSeries, ColorType, CrosshairMode, LineStyle, createChart, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import type { ChartLine } from './TickChart';
import { useTrader } from './TraderApp';

const THEME = {
  light: { text: '#3A4860', grid: 'rgba(11,31,58,.05)', bg: '#F7F9FC' },
  dark: { text: '#D7E0EE', grid: 'rgba(255,255,255,.07)', bg: 'transparent' },
};

/** Any CSS colour (var(), color-mix(), names) as a plain #rrggbb the chart library can read. */
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const toHex = (css: string, fallback = '#1F4FD1') => {
  if (!probe || !css) return fallback;
  probe.fillStyle = fallback;
  probe.fillStyle = css;
  const v = String(probe.fillStyle);
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
};
/** Blend two #rrggbb colours (w = share of the first). */
const mix = (hex: string, withHex: string, w: number) => {
  const a = parseInt(hex.slice(1), 16), b = parseInt(withHex.slice(1), 16);
  const ch = (s: number) => Math.round(((a >> s) & 255) * w + ((b >> s) & 255) * (1 - w));
  return `#${((1 << 24) + (ch(16) << 16) + (ch(8) << 8) + ch(0)).toString(16).slice(1)}`;
};
/** Resolve "var(--x)" and any other CSS colour from the page so chart lines match the site theme. */
const resolve = (el: HTMLElement, c: string) => {
  const m = c.match(/^var\((--[\w-]+)\)$/);
  return toHex(m ? getComputedStyle(el).getPropertyValue(m[1]).trim() : c);
};

/** Clean live tick chart (same engine as Charts): white background in light mode, price lines for entry/barriers. */
export function LiveChart({ prices, times, lines = [], decimals = 2 }: { prices: number[]; times: number[]; lines?: ChartLine[]; decimals?: number }) {
  const { dark } = useTrader();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const lastLen = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const th = dark ? THEME.dark : THEME.light;
    const base = toHex(getComputedStyle(el).getPropertyValue('--accent').trim() || '#1F4FD1');
    const accent = dark ? mix(base, '#FFFFFF', 0.5) : base;
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: th.bg }, textColor: th.text, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.1 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 6 },
      localization: { priceFormatter: (p: number) => p.toFixed(decimals) },
    });
    const s = c.addSeries(AreaSeries, { lineColor: accent, topColor: `${accent}40`, bottomColor: `${accent}03`, lineWidth: 2, priceLineColor: accent });
    chart.current = c; series.current = s; lastLen.current = 0; priceLines.current = [];
    return () => { chart.current = null; series.current = null; c.remove(); };
  }, [dark, decimals]);

  // Prices: full reset on a new market, then cheap updates tick by tick.
  useEffect(() => {
    const s = series.current;
    if (!s || prices.length < 2) return;
    const data = prices.map((p, i) => ({ time: times[i] as UTCTimestamp, value: p }));
    // Ticks can share a second: keep the time axis strictly increasing.
    for (let i = 1; i < data.length; i++) if ((data[i].time as number) <= (data[i - 1].time as number)) data[i].time = ((data[i - 1].time as number) + 1) as UTCTimestamp;
    if (Math.abs(prices.length - lastLen.current) > 1 || lastLen.current === 0) {
      s.setData(data);
      chart.current?.timeScale().fitContent();
    } else {
      try { s.update(data[data.length - 1]); } catch { s.setData(data); }
    }
    lastLen.current = prices.length;
  }, [prices, times]);

  // Entry / barrier / range lines.
  useEffect(() => {
    const s = series.current, el = box.current;
    if (!s || !el) return;
    priceLines.current.forEach((l) => s.removePriceLine(l));
    priceLines.current = lines.map((l) => s.createPriceLine({ price: l.value, color: resolve(el, l.color), lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.label }));
  }, [lines.map((l) => `${l.label}:${l.value}`).join('|'), dark]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="live-chart" ref={box} />;
}
