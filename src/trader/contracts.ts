import { useEffect, useState } from 'react';
import { publicSocket } from '../lib/derivWs';

/** What Deriv offers on one market (from contracts_for): available types, tick limits, multipliers. */
export interface MarketOffer {
  types: Set<string>;
  multipliers: number[];
  ticks: Record<string, { min: number; max: number }>;
}

const cache = new Map<string, Promise<MarketOffer>>();
const tickNum = (s: unknown) => { const m = String(s ?? '').match(/^(\d+)t$/); return m ? Number(m[1]) : null; };

export function loadOffer(symbol: string): Promise<MarketOffer> {
  let p = cache.get(symbol);
  if (!p) {
    p = (async () => {
      const ws = publicSocket();
      try {
        const r = await ws.send<{ contracts_for?: { available?: Record<string, unknown>[] } }>({ contracts_for: symbol });
        const offer: MarketOffer = { types: new Set(), multipliers: [], ticks: {} };
        for (const c of r.contracts_for?.available ?? []) {
          const type = String(c.contract_type);
          offer.types.add(type);
          const mr = c.multiplier_range as number[] | undefined;
          if (Array.isArray(mr)) offer.multipliers = [...new Set([...offer.multipliers, ...mr])].sort((a, b) => a - b);
          const min = tickNum(c.min_contract_duration), max = tickNum(c.max_contract_duration);
          if (min !== null && max !== null) offer.ticks[type] = { min, max };
        }
        return offer;
      } finally { ws.close(); }
    })().catch((e) => { cache.delete(symbol); throw e; });
    cache.set(symbol, p);
  }
  return p;
}

export function useOffer(symbol: string) {
  const [offer, setOffer] = useState<MarketOffer | null>(null);
  useEffect(() => {
    let live = true;
    setOffer(null);
    loadOffer(symbol).then((o) => live && setOffer(o)).catch(() => undefined);
    return () => { live = false; };
  }, [symbol]);
  return offer;
}
