import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DERIV_AUTH_TOKEN_URL, derivFetch, env } from '../_lib/deriv.js';
import { query, upsertOperator, type DerivAccount } from '../_lib/db.js';
import { noStore, sameOrigin, setSession } from '../_lib/session.js';
import { resolveTenant } from '../_lib/tenant.js';
import { clientIp, rateLimit } from '../_lib/guard.js';
import { snapshotEarnings } from '../_lib/earnings.js';

/** Map the Deriv login to a Mwasya operator. Login still succeeds if this fails (Bot Forge will ask to re-login). */
async function resolveOperator(token: string, invite?: string): Promise<string | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  try {
    const r = await derivFetch('/trading/v1/options/accounts', token);
    if (!r.ok) return undefined;
    const { data } = (await r.json()) as { data?: DerivAccount[] };
    const accounts = (data ?? []).filter((a) => typeof a.account_id === 'string' && (a.account_type === 'demo' || a.account_type === 'real'));
    return await upsertOperator(accounts, invite);
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

  const { code, code_verifier, invite } = (req.body ?? {}) as { code?: unknown; code_verifier?: unknown; invite?: unknown };
  if (typeof code !== 'string' || typeof code_verifier !== 'string' ||
      code.length > 2048 || !/^[A-Za-z0-9\-._~]{43,128}$/.test(code_verifier)) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  try {
    // Slow down brute force / abuse: 20 login attempts per IP per 10 minutes.
    if (process.env.DATABASE_URL && !(await rateLimit(`login:${clientIp(req)}`, 20, 600))) return res.status(429).json({ error: 'too_many_attempts' });

    // Studio logins use Mwasya's app; trader-site logins use the operator's own Deriv app.
    const tenant = await resolveTenant(req);
    if (tenant.kind === 'unknown') return res.status(404).json({ error: 'unknown_site' });
    const clientId = tenant.kind === 'site' ? tenant.site.deriv_app_id : env('DERIV_APP_ID');
    const redirectUri = tenant.kind === 'site' ? `https://${tenant.host}/callback` : env('DERIV_REDIRECT_URI');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
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
    // Only studio logins create/attach an operator workspace. Traders never become operators.
    const operatorId = tenant.kind === 'platform' ? await resolveOperator(data.access_token, typeof invite === 'string' ? invite : undefined) : undefined;
    // A client login that reached us proves this address's redirect URI is registered on the mentor's Deriv app.
    if (tenant.kind === 'site') {
      const onSub = tenant.host.endsWith('.mwasya.site');
      await query(
        `update sites set client_logins = client_logins + 1, ${onSub ? 'sub_login_at' : 'domain_login_at'} = now() where id = $1`,
        [tenant.site.id],
      ).catch(() => undefined);
    }
    // Refresh this mentor's commission snapshot (works when the login included read-only application_read). Never blocks login.
    if (operatorId) await Promise.race([snapshotEarnings(operatorId, data.access_token).catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
    setSession(res, { accessToken: data.access_token, expiresAt, operatorId, siteId: tenant.kind === 'site' ? tenant.site.id : undefined });
    return res.status(200).json({ ok: true, expiresAt });
  } catch {
    return res.status(500).json({ error: 'server_error' });
  }
}
