import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DERIV_AUTH_TOKEN_URL } from '../../../api/_lib/deriv.js';
import { getSession, noStore, sameOrigin, setPaySession, setSession } from '../../../api/_lib/session.js';

/**
 * POST /api/auth/token  { code, code_verifier, purpose? }  — standalone client site.
 * Same OAuth 2.0 + PKCE exchange as the Mwasya platform, but the Deriv app comes from this
 * site's own settings (DERIV_APP_ID) instead of the Mwasya database. The token stays server-side
 * in an encrypted HttpOnly cookie; the browser never sees it.
 */
const SITE_ID = 'standalone';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });

  const appId = process.env.DERIV_APP_ID;
  if (!appId) return res.status(500).json({ error: 'site_not_configured' });

  const { code, code_verifier, purpose } = (req.body ?? {}) as { code?: unknown; code_verifier?: unknown; purpose?: unknown };
  if (typeof code !== 'string' || typeof code_verifier !== 'string' || code.length > 2048 || !/^[A-Za-z0-9\-._~]{43,128}$/.test(code_verifier)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  // Deriv only accepts a redirect address registered on the app, so a wrong host simply fails here.
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return res.status(400).json({ error: 'bad_host' });

  try {
    const r = await fetch(DERIV_AUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: appId, code, redirect_uri: `https://${host}/callback`, code_verifier }),
    });
    if (!r.ok) return res.status(401).json({ error: 'exchange_failed' });
    const data = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token || !data.expires_in) return res.status(502).json({ error: 'bad_token_response' });
    const expiresAt = Date.now() + data.expires_in * 1000;

    // Cashier step-up: the payment-scoped token only goes into the short cashier cookie.
    if (purpose === 'cashier') {
      if (!getSession(req)) return res.status(401).json({ error: 'not_logged_in' });
      const until = setPaySession(res, data.access_token, expiresAt, SITE_ID);
      return res.status(200).json({ ok: true, cashierUntil: until });
    }
    setSession(res, { accessToken: data.access_token, expiresAt, siteId: SITE_ID });
    return res.status(200).json({ ok: true, expiresAt });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}
