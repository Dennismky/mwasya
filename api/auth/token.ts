import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DERIV_AUTH_TOKEN_URL, derivFetch, env } from '../_lib/deriv.js';
import { upsertOperator, type DerivAccount } from '../_lib/db.js';
import { noStore, sameOrigin, setSession } from '../_lib/session.js';

/** Map the Deriv login to a Mwasya operator. Login still succeeds if this fails (Bot Forge will ask to re-login). */
async function resolveOperator(token: string): Promise<string | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  try {
    const r = await derivFetch('/trading/v1/options/accounts', token);
    if (!r.ok) return undefined;
    const { data } = (await r.json()) as { data?: DerivAccount[] };
    const accounts = (data ?? []).filter((a) => typeof a.account_id === 'string' && (a.account_type === 'demo' || a.account_type === 'real'));
    return await upsertOperator(accounts);
  } catch (e) {
    console.error('resolveOperator failed', e);
    return undefined;
  }
}

/**
 * POST /api/auth/token  { code, code_verifier }
 * Exchanges the single-use OAuth code (PKCE) for an access token on the server,
 * then stores it in an encrypted HttpOnly cookie. The token is never returned to the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });

  const { code, code_verifier } = (req.body ?? {}) as { code?: unknown; code_verifier?: unknown };
  if (typeof code !== 'string' || typeof code_verifier !== 'string' ||
      code.length > 2048 || !/^[A-Za-z0-9\-._~]{43,128}$/.test(code_verifier)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: env('DERIV_APP_ID'),
      code,
      redirect_uri: env('DERIV_REDIRECT_URI'),
      code_verifier,
    });
    const r = await fetch(DERIV_AUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!r.ok) return res.status(401).json({ error: 'exchange_failed' });

    const data = (await r.json()) as { access_token?: string; expires_in?: number; token_type?: string };
    if (!data.access_token || !data.expires_in) return res.status(502).json({ error: 'bad_token_response' });

    const expiresAt = Date.now() + data.expires_in * 1000;
    const operatorId = await resolveOperator(data.access_token);
    setSession(res, { accessToken: data.access_token, expiresAt, operatorId });
    return res.status(200).json({ ok: true, expiresAt });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}
