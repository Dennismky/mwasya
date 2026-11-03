import type { VercelRequest, VercelResponse } from '@vercel/node';
import { derivFetch } from '../_lib/deriv.js';
import { clearSession, getSession, noStore, sameOrigin } from '../_lib/session.js';
import { clientIp, rateLimit } from '../_lib/guard.js';

/**
 * POST /api/deriv/otp  { accountId }
 * Asks Deriv for a one-time WebSocket URL for this account.
 * The browser connects to that URL directly; no token is ever sent to the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'not_logged_in' });
  // A page opens a few sockets per account; 60/min per IP is far above normal use and stops abuse.
  if (process.env.DATABASE_URL && !(await rateLimit(`otp:${clientIp(req)}`, 60, 60))) return res.status(429).json({ error: 'too_many_requests' });

  const { accountId } = (req.body ?? {}) as { accountId?: unknown };
  if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
    return res.status(400).json({ error: 'invalid_account' });
  }

  try {
    const r = await derivFetch(`/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, s.accessToken, {
      method: 'POST',
    });
    if (r.status === 401) {
      clearSession(res);
      return res.status(401).json({ error: 'session_expired' });
    }
    if (!r.ok) return res.status(502).json({ error: 'deriv_error', status: r.status });

    const data = (await r.json()) as { data?: { url?: string } };
    const url = data.data?.url;
    if (!url || !url.startsWith('wss://api.derivws.com/')) return res.status(502).json({ error: 'bad_otp_response' });
    return res.status(200).json({ url });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}
