import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSession, noStore } from '../_lib/session.js';
import { burst } from '../_lib/burst.js';

/** GET /api/auth/session → { loggedIn, expiresAt, operator } (never the token itself). */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!burst(req, res, 'session', 120)) return;
  noStore(res);
  const s = getSession(req);
  return res.status(200).json(s ? { loggedIn: true, expiresAt: s.expiresAt, operator: Boolean(s.operatorId) } : { loggedIn: false });
}
