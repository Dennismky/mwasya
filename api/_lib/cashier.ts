import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { derivFetch } from './deriv.js';
import { clientIp, rateLimit } from './guard.js';
import { clearPaySession, getPaySession, getSession } from './session.js';

/**
 * Client cashier through Deriv's payment-agent API (https://developers.deriv.com/llms/payment-agent-withdraw.md).
 * - Uses ONLY the short-lived cashier cookie (payment scope) that the client granted on Deriv's own page.
 * - A withdrawal needs the 6-digit code Deriv sends to the client's own email: the site can never move funds alone.
 * - Nothing is stored; amounts and codes are passed straight to Deriv.
 */
const AMOUNT = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,8})?$/;
const CURRENCY = /^[A-Z_]{1,18}$/;

type Body = { action?: string; currency?: unknown; agent_id?: unknown; amount?: unknown; verification_code?: unknown; request_id?: unknown; country?: unknown };

async function deriv(res: VercelResponse, token: string, path: string, init?: RequestInit) {
  const r = await derivFetch(path, token, init);
  const j = (await r.json().catch(() => ({}))) as { data?: unknown; errors?: { code?: string; message?: string }[] };
  if (r.status === 401 || r.status === 403) { clearPaySession(res); res.status(401).json({ error: 'cashier_expired' }); return null; }
  if (!r.ok || j.errors?.length) {
    res.status(r.status >= 500 ? 502 : 422).json({ error: j.errors?.[0]?.message ?? 'Deriv could not complete this request.' });
    return null;
  }
  return j.data;
}

export async function cashier(req: VercelRequest, res: VercelResponse, b: Body) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'not_logged_in' });
  const pay = getPaySession(req);

  if (b.action === 'cashier_status') return res.status(200).json({ allowed: !!pay && pay.siteId === s.siteId, until: pay?.expiresAt ?? null });
  if (b.action === 'cashier_end') { clearPaySession(res); return res.status(200).json({ ok: true }); }
  if (!pay || pay.siteId !== s.siteId) return res.status(401).json({ error: 'cashier_expired' });
  if (process.env.DATABASE_URL && !(await rateLimit(`cashier:${clientIp(req)}`, 30, 600))) return res.status(429).json({ error: 'Too many requests. Wait a few minutes.' });

  const currency = typeof b.currency === 'string' && CURRENCY.test(b.currency) ? b.currency : '';
  if (b.action === 'cashier_agents') {
    if (!currency) return res.status(400).json({ error: 'invalid_request' });
    const q = new URLSearchParams({ currency, per_page: '50' });
    if (typeof b.country === 'string' && /^[a-z]{2}$/.test(b.country)) q.set('country', b.country);
    const data = await deriv(res, pay.accessToken, `/payment-agents/v1/agents?${q}`);
    return data === null ? undefined : res.status(200).json({ agents: data });
  }

  const agentId = Number(b.agent_id);
  const amount = typeof b.amount === 'string' && AMOUNT.test(b.amount) ? b.amount : '';
  if (!Number.isInteger(agentId) || agentId < 1 || !amount || !currency) return res.status(400).json({ error: 'Check the agent, amount and currency.' });

  if (b.action === 'cashier_code') {
    const data = await deriv(res, pay.accessToken, '/payment-agents/v1/withdraw/verification_code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { agent_id: agentId, amount, currency } }),
    });
    return data === null ? undefined : res.status(200).json(data);
  }
  if (b.action === 'cashier_withdraw') {
    const code = typeof b.verification_code === 'string' && /^\d{6}$/.test(b.verification_code) ? b.verification_code : '';
    if (!code) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
    const requestId = randomUUID();
    const data = await deriv(res, pay.accessToken, '/payment-agents/v1/withdraw', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { agent_id: agentId, amount, currency, verification_code: code, request_id: requestId } }),
    });
    return data === null ? undefined : res.status(200).json({ ...(data as object), request_id: requestId });
  }
  return res.status(400).json({ error: 'invalid_request' });
}
