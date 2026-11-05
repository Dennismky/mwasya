import type { VercelRequest, VercelResponse } from '@vercel/node';
import { clearSession, noStore, sameOrigin } from '../_lib/session.js';
import { burst } from '../_lib/burst.js';

/** POST /api/auth/logout — clears the session cookie. */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (!burst(req, res, 'logout', 30)) return;
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  clearSession(res);
  return res.status(200).json({ ok: true });
}
