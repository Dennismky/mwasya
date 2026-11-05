/**
 * Chart indicators (standard public formulas, our own implementation).
 * Each indicator turns bars into one or more plots. "overlay" plots sit on the price chart; "pane" plots get their own panel.
 * In tick mode every bar is a single price (open = high = low = close).
 */

export interface Bar { time: number; open: number; high: number; low: number; close: number }
export interface Pt { time: number; value: number; color?: string }
export interface Plot { kind: 'line' | 'hist' | 'dots'; color: string; data: Pt[]; width?: 1 | 2 }
export interface Output { plots: Plot[]; levels?: number[] }
export type Category = 'Momentum' | 'Trend' | 'Volatility' | 'Moving averages' | 'Others';
export interface IndicatorDef { id: string; name: string; category: Category; place: 'overlay' | 'pane'; icon: string; run: (b: Bar[]) => Output }

/* ---------------- helpers ---------------- */
const at = (b: Bar[], f: (x: Bar) => number) => b.map(f);
const pts = (b: Bar[], v: (number | null)[], from = 0): Pt[] => {
  const out: Pt[] = [];
  for (let i = from; i < b.length; i++) { const x = v[i]; if (x !== null && Number.isFinite(x)) out.push({ time: b[i].time, value: x as number }); }
  return out;
};
const smaArr = (v: number[], n: number): (number | null)[] => {
  const out: (number | null)[] = []; let s = 0;
  v.forEach((x, i) => { s += x; if (i >= n) s -= v[i - n]; out.push(i >= n - 1 ? s / n : null); });
  return out;
};
const emaArr = (v: (number | null)[], n: number): (number | null)[] => {
  const k = 2 / (n + 1); let e: number | null = null; let seen = 0;
  return v.map((x) => { if (x === null) return null; seen++; e = e === null ? x : x * k + e * (1 - k); return seen >= n ? e : null; });
};
const wmaArr = (v: (number | null)[], n: number): (number | null)[] => v.map((_, i) => {
  if (i < n - 1) return null; let s = 0, w = 0;
  for (let j = 0; j < n; j++) { const x = v[i - j]; if (x === null) return null; s += x * (n - j); w += n - j; }
  return s / w;
});
const wilder = (v: number[], n: number): (number | null)[] => {
  const out: (number | null)[] = []; let s = 0;
  v.forEach((x, i) => { if (i < n) { s += x; out.push(i === n - 1 ? s / n : null); } else { s = (s * (n - 1) + x) / n; out.push(s); } });
  return out;
};
const highest = (b: Bar[], i: number, n: number) => { let h = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) h = Math.max(h, b[j].high); return h; };
const lowest = (b: Bar[], i: number, n: number) => { let l = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) l = Math.min(l, b[j].low); return l; };
const trueRange = (b: Bar[]) => b.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close))));
const step = (b: Bar[]) => (b.length > 1 ? b[b.length - 1].time - b[b.length - 2].time || 60 : 60);
/** Shift a series forward by k bars, extending time past the last bar (Ichimoku). */
const shiftFwd = (b: Bar[], v: (number | null)[], k: number): Pt[] => {
  const dt = step(b), out: Pt[] = [];
  v.forEach((x, i) => {
    if (x === null) return;
    const j = i + k;
    const t = j < b.length ? b[j].time : b[b.length - 1].time + (j - b.length + 1) * dt;
    out.push({ time: t, value: x });
  });
  return out;
};

const C = { blue: '#3B6CF0', orange: '#F5A524', purple: '#A855F7', teal: '#22B8CF', red: '#E5484D', green: '#12A07A', pink: '#EC4899', grey: '#8A97AB', amber: '#E0A100' };

/* ---------------- indicators ---------------- */
export const INDICATORS: IndicatorDef[] = [
  // Momentum
  { id: 'ao', name: 'Awesome Oscillator', category: 'Momentum', place: 'pane', icon: '▮▮', run: (b) => {
    const mid = at(b, (x) => (x.high + x.low) / 2); const f = smaArr(mid, 5), s = smaArr(mid, 34);
    const v = f.map((x, i) => (x !== null && s[i] !== null ? x - (s[i] as number) : null));
    const data = pts(b, v).map((p, i, a) => ({ ...p, color: i > 0 && p.value >= a[i - 1].value ? C.green : C.red }));
    return { plots: [{ kind: 'hist', color: C.green, data }], levels: [0] };
  } },
  { id: 'dpo', name: 'Detrended Price Oscillator', category: 'Momentum', place: 'pane', icon: '∿', run: (b) => {
    const n = 20, c = at(b, (x) => x.close), s = smaArr(c, n), back = Math.floor(n / 2) + 1;
    return { plots: [{ kind: 'line', color: C.teal, data: pts(b, c.map((_, i) => (i - back >= 0 && s[i] !== null ? c[i - back] - (s[i] as number) : null))) }], levels: [0] };
  } },
  { id: 'macd', name: 'MACD', category: 'Momentum', place: 'pane', icon: '⫽', run: (b) => {
    const c = at(b, (x) => x.close); const f = emaArr(c, 12), s = emaArr(c, 26);
    const line = f.map((x, i) => (x !== null && s[i] !== null ? x - (s[i] as number) : null));
    const sig = emaArr(line, 9);
    const hist = pts(b, line.map((x, i) => (x !== null && sig[i] !== null ? x - (sig[i] as number) : null))).map((p) => ({ ...p, color: p.value >= 0 ? C.green : C.red }));
    return { plots: [{ kind: 'hist', color: C.green, data: hist }, { kind: 'line', color: C.blue, data: pts(b, line) }, { kind: 'line', color: C.orange, data: pts(b, sig) }], levels: [0] };
  } },
  { id: 'roc', name: 'Price Rate of Change', category: 'Momentum', place: 'pane', icon: '↗', run: (b) => {
    const n = 12, c = at(b, (x) => x.close);
    return { plots: [{ kind: 'line', color: C.purple, data: pts(b, c.map((x, i) => (i >= n ? ((x - c[i - n]) / c[i - n]) * 100 : null))) }], levels: [0] };
  } },
  { id: 'rsi', name: 'Relative Strength Index (RSI)', category: 'Momentum', place: 'pane', icon: '⌇', run: (b) => {
    const n = 14, c = at(b, (x) => x.close);
    const up = c.map((x, i) => (i ? Math.max(x - c[i - 1], 0) : 0)), dn = c.map((x, i) => (i ? Math.max(c[i - 1] - x, 0) : 0));
    const au = wilder(up.slice(1), n), ad = wilder(dn.slice(1), n);
    const v = [null, ...au.map((u, i) => (u === null || ad[i] === null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / (ad[i] as number))))];
    return { plots: [{ kind: 'line', color: C.red, data: pts(b, v) }], levels: [70, 30] };
  } },
  { id: 'stoch', name: 'Stochastic Oscillator', category: 'Momentum', place: 'pane', icon: '≋', run: (b) => {
    const raw = b.map((x, i) => { const h = highest(b, i, 14), l = lowest(b, i, 14); return i < 13 ? null : h === l ? 50 : ((x.close - l) / (h - l)) * 100; });
    const k = smaArr(raw.map((x) => x ?? 0), 3).map((x, i) => (raw[i] === null || i < 15 ? null : x));
    const d = smaArr(k.map((x) => x ?? 0), 3).map((x, i) => (k[i] === null || i < 17 ? null : x));
    return { plots: [{ kind: 'line', color: C.blue, data: pts(b, k) }, { kind: 'line', color: C.orange, data: pts(b, d) }], levels: [80, 20] };
  } },
  { id: 'smi', name: 'Stochastic Momentum Index', category: 'Momentum', place: 'pane', icon: '≈', run: (b) => {
    const rel = b.map((x, i) => x.close - (highest(b, i, 10) + lowest(b, i, 10)) / 2), rng = b.map((_, i) => highest(b, i, 10) - lowest(b, i, 10));
    const n = emaArr(emaArr(rel, 3), 3), d = emaArr(emaArr(rng, 3), 3);
    const smi = n.map((x, i) => (x === null || d[i] === null || d[i] === 0 ? null : (100 * x) / (0.5 * (d[i] as number))));
    return { plots: [{ kind: 'line', color: C.pink, data: pts(b, smi) }, { kind: 'line', color: C.grey, data: pts(b, emaArr(smi, 3)) }], levels: [40, -40] };
  } },
  { id: 'willr', name: "William's Percent Range", category: 'Momentum', place: 'pane', icon: '%', run: (b) => {
    const v = b.map((x, i) => { const h = highest(b, i, 14), l = lowest(b, i, 14); return i < 13 ? null : h === l ? -50 : ((h - x.close) / (h - l)) * -100; });
    return { plots: [{ kind: 'line', color: C.purple, data: pts(b, v) }], levels: [-20, -80] };
  } },
  // Trend
  { id: 'adx', name: 'Average Directional Index (ADX)', category: 'Trend', place: 'pane', icon: '⇗', run: (b) => {
    const n = 14, tr = trueRange(b);
    const pdm = b.map((x, i) => (i ? (x.high - b[i - 1].high > b[i - 1].low - x.low ? Math.max(x.high - b[i - 1].high, 0) : 0) : 0));
    const mdm = b.map((x, i) => (i ? (b[i - 1].low - x.low > x.high - b[i - 1].high ? Math.max(b[i - 1].low - x.low, 0) : 0) : 0));
    const atr = wilder(tr, n), sp = wilder(pdm, n), sm = wilder(mdm, n);
    const pdi = atr.map((a, i) => (a ? (100 * (sp[i] as number)) / a : null)), mdi = atr.map((a, i) => (a ? (100 * (sm[i] as number)) / a : null));
    const dx = pdi.map((p, i) => (p === null || mdi[i] === null || p + (mdi[i] as number) === 0 ? 0 : (100 * Math.abs(p - (mdi[i] as number))) / (p + (mdi[i] as number))));
    const adx = wilder(dx.slice(n), n);
    return { plots: [{ kind: 'line', color: C.orange, data: pts(b, [...Array(n).fill(null), ...adx]) }, { kind: 'line', color: C.green, data: pts(b, pdi) }, { kind: 'line', color: C.red, data: pts(b, mdi) }], levels: [25] };
  } },
  { id: 'aroon', name: 'Aroon', category: 'Trend', place: 'pane', icon: '⇅', run: (b) => {
    const n = 14;
    const up = b.map((_, i) => { if (i < n) return null; let k = 0; for (let j = 0; j <= n; j++) if (b[i - j].high >= b[i - k].high) k = j; return (100 * (n - k)) / n; });
    const dn = b.map((_, i) => { if (i < n) return null; let k = 0; for (let j = 0; j <= n; j++) if (b[i - j].low <= b[i - k].low) k = j; return (100 * (n - k)) / n; });
    return { plots: [{ kind: 'line', color: C.green, data: pts(b, up) }, { kind: 'line', color: C.red, data: pts(b, dn) }], levels: [70, 30] };
  } },
  { id: 'psar', name: 'Parabolic SAR', category: 'Trend', place: 'overlay', icon: '⋰', run: (b) => {
    if (b.length < 3) return { plots: [] };
    const out: (number | null)[] = [null]; let up = b[1].close >= b[0].close, af = 0.02, ep = up ? b[0].high : b[0].low, sar = up ? b[0].low : b[0].high;
    for (let i = 1; i < b.length; i++) {
      sar = sar + af * (ep - sar);
      if (up) { sar = Math.min(sar, b[i - 1].low, b[Math.max(0, i - 2)].low); if (b[i].low < sar) { up = false; sar = ep; ep = b[i].low; af = 0.02; } else if (b[i].high > ep) { ep = b[i].high; af = Math.min(af + 0.02, 0.2); } }
      else { sar = Math.max(sar, b[i - 1].high, b[Math.max(0, i - 2)].high); if (b[i].high > sar) { up = true; sar = ep; ep = b[i].high; af = 0.02; } else if (b[i].low < ep) { ep = b[i].low; af = Math.min(af + 0.02, 0.2); } }
      out.push(sar);
    }
    return { plots: [{ kind: 'dots', color: C.amber, data: pts(b, out) }] };
  } },
  { id: 'ichimoku', name: 'Ichimoku Cloud', category: 'Trend', place: 'overlay', icon: '☁', run: (b) => {
    const mid = (n: number) => b.map((_, i) => (i < n - 1 ? null : (highest(b, i, n) + lowest(b, i, n)) / 2));
    const tenkan = mid(9), kijun = mid(26), spanB = mid(52);
    const spanA = tenkan.map((t, i) => (t === null || kijun[i] === null ? null : (t + (kijun[i] as number)) / 2));
    return { plots: [
      { kind: 'line', color: C.blue, data: pts(b, tenkan), width: 1 }, { kind: 'line', color: C.red, data: pts(b, kijun), width: 1 },
      { kind: 'line', color: C.green, data: shiftFwd(b, spanA, 26), width: 1 }, { kind: 'line', color: C.pink, data: shiftFwd(b, spanB, 26), width: 1 },
    ] };
  } },
  { id: 'zigzag', name: 'ZigZag', category: 'Trend', place: 'overlay', icon: '⩘', run: (b) => {
    if (b.length < 3) return { plots: [] };
    const dev = 0.002; const piv: Pt[] = [{ time: b[0].time, value: b[0].close }]; let dir = 0, ext = b[0].close, extT = b[0].time;
    for (const x of b.slice(1)) {
      if (dir >= 0 && x.high > ext) { ext = x.high; extT = x.time; if (dir === 0) dir = 1; }
      else if (dir <= 0 && x.low < ext) { ext = x.low; extT = x.time; if (dir === 0) dir = -1; }
      if (dir === 1 && x.low < ext * (1 - dev)) { piv.push({ time: extT, value: ext }); dir = -1; ext = x.low; extT = x.time; }
      else if (dir === -1 && x.high > ext * (1 + dev)) { piv.push({ time: extT, value: ext }); dir = 1; ext = x.high; extT = x.time; }
    }
    piv.push({ time: extT, value: ext });
    return { plots: [{ kind: 'line', color: C.orange, data: piv.filter((p, i, a) => i === 0 || p.time > a[i - 1].time) }] };
  } },
  // Volatility
  { id: 'bb', name: 'Bollinger Bands', category: 'Volatility', place: 'overlay', icon: '⊜', run: (b) => {
    const c = at(b, (x) => x.close), m = smaArr(c, 20);
    const sd = c.map((_, i) => { if (m[i] === null) return null; let s = 0; for (let j = i - 19; j <= i; j++) s += (c[j] - (m[i] as number)) ** 2; return Math.sqrt(s / 20); });
    return { plots: [
      { kind: 'line', color: C.teal, data: pts(b, m.map((x, i) => (x === null ? null : x + 2 * (sd[i] as number)))), width: 1 },
      { kind: 'line', color: C.grey, data: pts(b, m), width: 1 },
      { kind: 'line', color: C.teal, data: pts(b, m.map((x, i) => (x === null ? null : x - 2 * (sd[i] as number)))), width: 1 },
    ] };
  } },
  { id: 'donchian', name: 'Donchian Channel', category: 'Volatility', place: 'overlay', icon: '⊟', run: (b) => {
    const n = 20, hi = b.map((_, i) => (i < n - 1 ? null : highest(b, i, n))), lo = b.map((_, i) => (i < n - 1 ? null : lowest(b, i, n)));
    return { plots: [{ kind: 'line', color: C.blue, data: pts(b, hi), width: 1 }, { kind: 'line', color: C.grey, data: pts(b, hi.map((h, i) => (h === null ? null : (h + (lo[i] as number)) / 2))), width: 1 }, { kind: 'line', color: C.blue, data: pts(b, lo), width: 1 }] };
  } },
  { id: 'keltner', name: 'Keltner Channel', category: 'Volatility', place: 'overlay', icon: '⊞', run: (b) => {
    const m = emaArr(at(b, (x) => x.close), 20), atr = wilder(trueRange(b), 10);
    const band = (s: number) => m.map((x, i) => (x === null || atr[i] === null ? null : x + s * 2 * (atr[i] as number)));
    return { plots: [{ kind: 'line', color: C.purple, data: pts(b, band(1)), width: 1 }, { kind: 'line', color: C.grey, data: pts(b, m), width: 1 }, { kind: 'line', color: C.purple, data: pts(b, band(-1)), width: 1 }] };
  } },
  { id: 'atr', name: 'Average True Range', category: 'Volatility', place: 'pane', icon: '↕', run: (b) => ({ plots: [{ kind: 'line', color: C.orange, data: pts(b, wilder(trueRange(b), 14)) }] }) },
  { id: 'stddev', name: 'Standard Deviation', category: 'Volatility', place: 'pane', icon: 'σ', run: (b) => {
    const c = at(b, (x) => x.close), m = smaArr(c, 20);
    return { plots: [{ kind: 'line', color: C.teal, data: pts(b, c.map((_, i) => { if (m[i] === null) return null; let s = 0; for (let j = i - 19; j <= i; j++) s += (c[j] - (m[i] as number)) ** 2; return Math.sqrt(s / 20); })) }] };
  } },
  // Moving averages
  { id: 'sma', name: 'Simple Moving Average (20)', category: 'Moving averages', place: 'overlay', icon: '∩', run: (b) => ({ plots: [{ kind: 'line', color: C.orange, data: pts(b, smaArr(at(b, (x) => x.close), 20)) }] }) },
  { id: 'ema', name: 'Exponential Moving Average (50)', category: 'Moving averages', place: 'overlay', icon: '∩', run: (b) => ({ plots: [{ kind: 'line', color: C.purple, data: pts(b, emaArr(at(b, (x) => x.close), 50)) }] }) },
  { id: 'wma', name: 'Weighted Moving Average (20)', category: 'Moving averages', place: 'overlay', icon: '∩', run: (b) => ({ plots: [{ kind: 'line', color: C.teal, data: pts(b, wmaArr(at(b, (x) => x.close), 20)) }] }) },
  { id: 'hma', name: 'Hull Moving Average (20)', category: 'Moving averages', place: 'overlay', icon: '∩', run: (b) => {
    const c = at(b, (x) => x.close), half = wmaArr(c, 10), full = wmaArr(c, 20);
    const raw = half.map((h, i) => (h === null || full[i] === null ? null : 2 * h - (full[i] as number)));
    return { plots: [{ kind: 'line', color: C.pink, data: pts(b, wmaArr(raw, Math.round(Math.sqrt(20)))) }] };
  } },
  { id: 'env', name: 'Moving Average Envelope', category: 'Moving averages', place: 'overlay', icon: '⌒', run: (b) => {
    const m = smaArr(at(b, (x) => x.close), 20), p = 0.0025;
    return { plots: [{ kind: 'line', color: C.blue, data: pts(b, m.map((x) => (x === null ? null : x * (1 + p)))), width: 1 }, { kind: 'line', color: C.grey, data: pts(b, m), width: 1 }, { kind: 'line', color: C.blue, data: pts(b, m.map((x) => (x === null ? null : x * (1 - p)))), width: 1 }] };
  } },
  // Others
  { id: 'cci', name: 'Commodity Channel Index', category: 'Others', place: 'pane', icon: '⌁', run: (b) => {
    const tp = at(b, (x) => (x.high + x.low + x.close) / 3), m = smaArr(tp, 20);
    const v = tp.map((x, i) => { if (m[i] === null) return null; let d = 0; for (let j = i - 19; j <= i; j++) d += Math.abs(tp[j] - (m[i] as number)); d /= 20; return d === 0 ? 0 : (x - (m[i] as number)) / (0.015 * d); });
    return { plots: [{ kind: 'line', color: C.blue, data: pts(b, v) }], levels: [100, -100] };
  } },
  { id: 'tp', name: 'Typical Price', category: 'Others', place: 'overlay', icon: '≡', run: (b) => ({ plots: [{ kind: 'line', color: C.grey, data: pts(b, at(b, (x) => (x.high + x.low + x.close) / 3)), width: 1 }] }) },
];

export const CATEGORIES: Category[] = ['Momentum', 'Trend', 'Volatility', 'Moving averages', 'Others'];
export const byId = (id: string) => INDICATORS.find((i) => i.id === id);
