import { useEffect, useState } from 'react';
import { publicSocket, type DerivSocket } from '../lib/derivWs';

/**
 * One public connection and ONE Deriv subscription per symbol for the whole trading site
 * (Deriv rejects duplicate subscriptions on a connection). Ticker, charts and analysis share it.
 */
let sock: DerivSocket | null = null;
const socket = () => (sock ??= publicSocket());

type Listener = (quote: number, epoch: number) => void;
const hubs = new Map<string, { listeners: Set<Listener>; stop?: () => void; starting?: Promise<void> }>();

export function subscribeTicks(symbol: string, cb: Listener): () => void {
  let hub = hubs.get(symbol);
  if (!hub) {
    hub = { listeners: new Set() };
    hubs.set(symbol, hub);
    const h = hub;
    h.starting = socket().subscribe({ ticks: symbol }, (m) => {
      const t = m.tick as { quote?: number; epoch?: number } | undefined;
      if (typeof t?.quote === 'number') for (const l of h.listeners) l(t.quote, t.epoch ?? Math.floor(Date.now() / 1000));
    }).then((u) => { h.stop = u; }).catch(() => { hubs.delete(symbol); });
  }
  hub.listeners.add(cb);
  return () => {
    const h = hubs.get(symbol);
    if (!h) return;
    h.listeners.delete(cb);
    if (h.listeners.size === 0) {
      hubs.delete(symbol);
      void h.starting?.then(() => h.stop?.());
    }
  };
}

export async function tickHistory(symbol: string, count: number): Promise<{ prices: number[]; times: number[] }> {
  const r = await socket().send<{ history?: { prices: number[]; times: number[] } }>({ ticks_history: symbol, end: 'latest', count, style: 'ticks' });
  return { prices: r.history?.prices ?? [], times: r.history?.times ?? [] };
}

/** Decimal places used by a symbol's quotes (inferred from recent prices). */
export function decimalsOf(prices: number[]): number {
  let d = 0;
  for (const p of prices.slice(-50)) {
    const s = String(p);
    const i = s.indexOf('.');
    if (i >= 0) d = Math.max(d, s.length - i - 1);
  }
  return d;
}
export const lastDigit = (price: number, decimals: number) => Math.abs(Math.round(price * 10 ** decimals)) % 10;

/** Recent history + live ticks for one symbol, capped at `keep` points. */
export function useTicks(symbol: string, keep = 300) {
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false); setPrices([]); setTimes([]);
    const buffer: [number, number][] = [];
    let loaded = false;
    const push = (q: number, e: number) => {
      setPrices((p) => (p.length >= keep ? [...p.slice(p.length - keep + 1), q] : [...p, q]));
      setTimes((t) => (t.length >= keep ? [...t.slice(t.length - keep + 1), e] : [...t, e]));
    };
    const off = subscribeTicks(symbol, (q, e) => { if (!loaded) buffer.push([q, e]); else if (live) push(q, e); });
    tickHistory(symbol, keep).then((h) => {
      if (!live) return;
      const lastT = h.times[h.times.length - 1] ?? 0;
      const extra = buffer.filter(([, e]) => e > lastT);
      setPrices([...h.prices, ...extra.map(([q]) => q)].slice(-keep));
      setTimes([...h.times, ...extra.map(([, e]) => e)].slice(-keep));
      loaded = true;
      setReady(true);
    }).catch(() => { loaded = true; setReady(true); });
    return () => { live = false; off(); };
  }, [symbol, keep]);
  return { prices, times, ready };
}

export const SYMBOLS: { id: string; name: string; group: string }[] = [
  ...[10, 15, 25, 30, 50, 75, 90, 100].map((n) => ({ id: `1HZ${n}V`, name: `Volatility ${n} (1s) Index`, group: 'Continuous indices' })),
  ...[10, 25, 50, 75, 100].map((n) => ({ id: `R_${n}`, name: `Volatility ${n} Index`, group: 'Continuous indices' })),
  ...[50, 150, 300, 500, 600, 900, 1000].map((n) => ({ id: n === 150 || n === 300 ? `BOOM${n}N` : `BOOM${n}`, name: `Boom ${n} Index`, group: 'Crash/Boom' })),
  ...[50, 150, 300, 500, 600, 900, 1000].map((n) => ({ id: n === 150 || n === 300 ? `CRASH${n}N` : `CRASH${n}`, name: `Crash ${n} Index`, group: 'Crash/Boom' })),
  ...[10, 25, 50, 75, 100].map((n) => ({ id: `JD${n}`, name: `Jump ${n} Index`, group: 'Jump indices' })),
  { id: 'stpRNG', name: 'Step Index 100', group: 'Step indices' },
  { id: 'RDBULL', name: 'Bull Market Index', group: 'Daily reset' },
  { id: 'RDBEAR', name: 'Bear Market Index', group: 'Daily reset' },
];
export const symbolName = (id: string) => SYMBOLS.find((s) => s.id === id)?.name ?? id;
