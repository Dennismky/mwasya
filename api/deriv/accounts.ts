import type { VercelRequest, VercelResponse } from '@vercel/node';
import { derivFetch } from '../_lib/deriv.js';
import { clientIp, rateLimit } from '../_lib/guard.js';
import { clearSession, getSession, noStore, sameOrigin } from '../_lib/session.js';

/**
 * GET  /api/deriv/accounts                                — the user's Options trading accounts
 * POST /api/deriv/accounts { action: 'reset_demo', accountId } — top a DEMO account back up
 *      (https://developers.deriv.com/llms/reset-demo-balance.md; real accounts are refused by Deriv)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'not_logged_in' });

  try {
    if (req.method === 'POST') {
      const { action, accountId } = (req.body ?? {}) as { action?: unknown; accountId?: unknown };
      if (action !== 'reset_demo' || typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      if (process.env.DATABASE_URL && !(await rateLimit(`reset-demo:${clientIp(req)}`, 5, 3600))) {
        return res.status(429).json({ error: 'too_many_requests' });
      }
      // Only ever a demo account: check our own copy of the account list first.
      const list = await derivFetch('/trading/v1/options/accounts', s.accessToken);
      if (list.status === 401) { clearSession(res); return res.status(401).json({ error: 'session_expired' }); }
      const { data } = (await list.json().catch(() => ({}))) as { data?: { account_id: string; account_type: string }[] };
      const acct = (data ?? []).find((a) => a.account_id === accountId);
      if (!acct || acct.account_type !== 'demo') return res.status(403).json({ error: 'demo_only' });
      const r = await derivFetch(`/trading/v1/options/accounts/${encodeURIComponent(accountId)}/reset-demo-balance`, s.accessToken, { method: 'POST' });
      if (!r.ok) return res.status(502).json({ error: 'deriv_error', status: r.status });
      return res.status(200).json({ ok: true });
    }

    const r = await derivFetch('/trading/v1/options/accounts', s.accessToken);
    if (r.status === 401) {
      clearSession(res); // Deriv issues no refresh tokens: user must log in again.
      return res.status(401).json({ error: 'session_expired' });
    }
    if (!r.ok) return res.status(502).json({ error: 'deriv_error', status: r.status });
    return res.status(200).json(await r.json());
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}
