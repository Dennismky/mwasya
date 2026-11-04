import { useMemo } from 'react';

export interface ChartLine { value: number; label: string; color: string; dashed?: boolean }

/** Lightweight live tick chart (SVG, no library): area + line, price axis, optional barrier/entry lines. */
export function TickChart({ prices, times, height = 360, lines = [], decimals = 2 }: {
  prices: number[]; times: number[]; height?: number; lines?: ChartLine[]; decimals?: number;
}) {
  const W = 1000, H = height, padR = 78, padB = 24, padT = 12;
  const view = useMemo(() => {
    if (prices.length < 2) return null;
    const all = [...prices, ...lines.map((l) => l.value)];
    let min = Math.min(...all), max = Math.max(...all);
    const pad = (max - min || Math.abs(max) * 0.001 || 1) * 0.12;
    min -= pad; max += pad;
    const x = (i: number) => (i / (prices.length - 1)) * (W - padR);
    const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const path = prices.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
    const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * (i + 0.5)) / 5);
    const tIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (prices.length - 1)));
    return { x, y, path, ticks, tIdx };
  }, [prices, lines, H]);

  if (!view) return <div className="chart-empty" style={{ height }}><span className="spinner" /> Loading chart…</div>;
  const last = prices[prices.length - 1];
  const up = last >= prices[prices.length - 2];
  const fmtT = (e: number) => new Date(e * 1000).toISOString().slice(11, 19);

  return (
    <svg className="tick-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Price chart, last ${last.toFixed(decimals)}`}>
      <defs>
        <linearGradient id="tc-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {view.ticks.map((v) => (
        <g key={v}>
          <line x1="0" x2={W - padR} y1={view.y(v)} y2={view.y(v)} className="tc-grid" />
          <text x={W - padR + 6} y={view.y(v) + 4} className="tc-axis">{v.toFixed(decimals)}</text>
        </g>
      ))}
      {view.tIdx.map((i) => (
        <text key={i} x={Math.min(view.x(i), W - padR - 60)} y={H - 6} className="tc-axis">{times[i] ? fmtT(times[i]) : ''}</text>
      ))}
      <path d={`${view.path}L${view.x(prices.length - 1)},${H - padB}L0,${H - padB}Z`} fill="url(#tc-fill)" />
      <path d={view.path} fill="none" stroke="var(--chart-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {lines.map((l) => (
        <g key={l.label}>
          <line x1="0" x2={W - padR} y1={view.y(l.value)} y2={view.y(l.value)} stroke={l.color} strokeWidth="1.5" strokeDasharray={l.dashed ? '6 5' : undefined} vectorEffect="non-scaling-stroke" />
          <text x={4} y={view.y(l.value) - 4} fill={l.color} className="tc-label">{l.label} {l.value.toFixed(decimals)}</text>
        </g>
      ))}
      <circle cx={view.x(prices.length - 1)} cy={view.y(last)} r="4" fill={up ? 'var(--success)' : 'var(--danger)'} />
      <rect x={W - padR + 2} y={view.y(last) - 11} width={padR - 4} height="22" rx="4" fill={up ? 'var(--success)' : 'var(--danger)'} />
      <text x={W - padR + 6} y={view.y(last) + 4} className="tc-last">{last.toFixed(decimals)}</text>
    </svg>
  );
}
