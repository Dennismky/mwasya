import type { VercelRequest, VercelResponse } from '@vercel/node';
import { derivFetch } from '../_lib/deriv.js';
import { clearSession, getSession, noStore } from '../_lib/session.js';

/** GET /api/deriv/accounts — the user's Options trading accounts. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'not_logged_in' });

  try {
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
