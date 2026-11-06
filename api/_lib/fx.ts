import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Display-only exchange rate (USD → KES) for showing balances in Kenyan shillings.
 * Deriv's API has no public rate for KES (its only exchange-rate call is wallet-to-wallet and needs the payment scope),
 * so the rate comes from Coinbase's public rates (no key, refreshed every few minutes), with open.er-api.com as backup.
 * Cached here for 60 s so every visitor shares one lookup. Trades always stay in the account's own currency.
 */
// EDIT HERE: currencies clients may pick for display (the account itself always trades in USD).
const ALLOWED = new Set(['KES']);
const TTL = 60_000;
const cache = new Map<string, { rate: number; at: number; source: string }>();

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`fx ${r.status}`);
  return r.json();
}

async function lookup(cur: string): Promise<{ rate: number; source: string }> {
  try {
    const j = (await fetchJson('https://api.coinbase.com/v2/exchange-rates?currency=USD')) as { data?: { rates?: Record<string, string> } };
    const rate = Number(j.data?.rates?.[cur]);
    if (Number.isFinite(rate) && rate > 0) return { rate, source: 'Coinbase' };
  } catch { /* fall through to the backup */ }
  const j = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as { rates?: Record<string, number> };
  const rate = Number(j.rates?.[cur]);
  if (Number.isFinite(rate) && rate > 0) return { rate, source: 'ExchangeRate-API' };
  throw new Error('fx unavailable');
}

/** GET …?fx=KES → { base: 'USD', currency: 'KES', rate, at, source }. Public (no account data involved). */
export async function fxRate(req: VercelRequest, res: VercelResponse) {
  const cur = String(req.query.fx ?? '').toUpperCase();
  if (!ALLOWED.has(cur)) return res.status(400).json({ error: 'unsupported_currency' });
  const now = Date.now();
  let hit = cache.get(cur);
  if (!hit || now - hit.at > TTL) {
    try {
      const r = await lookup(cur);
      hit = { ...r, at: now };
      cache.set(cur, hit);
    } catch {
      // Serve the last good rate (up to a day old) rather than nothing.
      if (!hit || now - hit.at > 86_400_000) return res.status(503).json({ error: 'rate_unavailable' });
    }
  }
  return res.status(200).json({ base: 'USD', currency: cur, rate: hit.rate, at: hit.at, source: hit.source });
}
