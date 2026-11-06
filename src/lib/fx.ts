import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Display currency for balances: the account always trades in its own currency (USD on Deriv);
 * picking KES only changes how balances are shown, using a live USD→KES rate from /api/deriv/accounts?fx=KES.
 */
export type DisplayCur = 'USD' | 'KES';
// EDIT HERE: how often the shilling rate is refreshed while KES is selected (ms).
const REFRESH_MS = 60_000;
const KEY = 'mw_display_cur';
const listeners = new Set<() => void>();

const read = (): DisplayCur => (localStorage.getItem(KEY) === 'KES' ? 'KES' : 'USD');
export function setDisplayCur(c: DisplayCur) {
  localStorage.setItem(KEY, c);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) l(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}

export interface Fx { cur: DisplayCur; rate: number | null; at: number | null; source: string; change: -1 | 0 | 1 }

/** The chosen display currency plus the live rate (rate is null while USD is shown or before the first answer). */
export function useDisplayCurrency(): Fx {
  const cur = useSyncExternalStore(subscribe, read, () => 'USD' as DisplayCur);
  const [fx, setFx] = useState<{ rate: number | null; at: number | null; source: string; change: -1 | 0 | 1 }>({ rate: null, at: null, source: '', change: 0 });
  useEffect(() => {
    if (cur !== 'KES') return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/deriv/accounts?fx=KES', { credentials: 'same-origin' });
        if (!r.ok) return;
        const j = (await r.json()) as { rate?: number; at?: number; source?: string };
        if (stop || typeof j.rate !== 'number') return;
        setFx((p) => ({ rate: j.rate!, at: j.at ?? Date.now(), source: j.source ?? '', change: p.rate == null || p.rate === j.rate ? 0 : j.rate! > p.rate ? 1 : -1 }));
      } catch { /* keep the last rate */ }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [cur]);
  return { cur, ...fx };
}

/** Format an amount held in `accountCur` for display. Non-USD accounts are always shown as they are. */
export function showMoney(amount: number | undefined, accountCur: string | undefined, fx: Fx): string {
  if (amount === undefined || !Number.isFinite(amount)) return '—';
  const c = (accountCur ?? 'USD').toUpperCase();
  if (fx.cur === 'KES' && c === 'USD' && fx.rate) {
    return `KSh ${(amount * fx.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
}

/** "10000.00 USD" → 10000 (auth.balance is a display string). */
export const parseAmount = (s: string): number | undefined => {
  const n = Number(String(s).replace(/[^0-9.-]/g, ''));
  return String(s).trim() === '—' || !Number.isFinite(n) ? undefined : n;
};
