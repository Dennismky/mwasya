import { useSyncExternalStore } from 'react';
import { SYMBOLS } from './ticks';

/**
 * One market for the whole client site. Whatever market the client analyses (D-Circles, Charts, Signals, Manual Trader)
 * is the market Bot Builder and Quick Bot trade, so a bot never runs on a different volatility than the one studied.
 */
// EDIT HERE: market every client starts on.
export const DEFAULT_MARKET = '1HZ100V';
const KEY = 'mw_market';
const listeners = new Set<() => void>();

/** Markets a digit / rise-fall bot can trade (Volatility indices). */
export const BOT_MARKETS = SYMBOLS.filter((s) => /^(1HZ|R_)/.test(s.id));
export const isBotMarket = (id: string) => BOT_MARKETS.some((s) => s.id === id);

export function getMarket(): string {
  try { const v = localStorage.getItem(KEY); return v && SYMBOLS.some((s) => s.id === v) ? v : DEFAULT_MARKET; } catch { return DEFAULT_MARKET; }
}
export function setMarket(id: string) {
  if (!SYMBOLS.some((s) => s.id === id) || id === getMarket()) return;
  try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) l(); };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(l); window.removeEventListener('storage', onStorage); };
}
/** The site-wide market and its setter. */
export function useMarket(): [string, (id: string) => void] {
  return [useSyncExternalStore(subscribe, getMarket), setMarket];
}

/**
 * Hand a contract from an analysis page to Bot Builder: the bot is rebuilt from these settings on the same market.
 * (Bot Builder regenerates its blocks when the saved XML is cleared.)
 */
export function sendToBotBuilder(subdomain: string, pick: { symbol: string; contract: string; prediction?: number }) {
  const key = `mw_bot_${subdomain}`;
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* fresh */ }
  localStorage.setItem(key, JSON.stringify({ ...saved, symbol: pick.symbol, contract: pick.contract, ...(pick.prediction !== undefined ? { prediction: pick.prediction } : {}) }));
  localStorage.removeItem(`${key}_xml`); localStorage.removeItem(`${key}_name`);
  setMarket(pick.symbol);
}

/** Deriv's market / submarket names for a symbol, so a bot's Market block stays consistent. */
export function marketOfSymbol(symbol: string): [string, string] {
  const g = SYMBOLS.find((s) => s.id === symbol)?.group;
  return ['synthetic_index', g === 'Crash/Boom' ? 'crash_index' : g === 'Jump indices' ? 'jump_index' : g === 'Step indices' ? 'step_index' : g === 'Daily reset' ? 'random_daily' : 'random_index'];
}
