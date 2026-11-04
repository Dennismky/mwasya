import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, query } from './_lib/db.js';
import { audit, clientIp, getBilling, hasAccess, rateLimit, requireOperator, requireOwner, type Operator } from './_lib/guard.js';
import { mpesaConfigured, normalizePhone, stkPush, stkQuery, type StkOutcome } from './_lib/mpesa.js';
import { getSession, noStore, sameOrigin } from './_lib/session.js';
import { derivFetch } from './_lib/deriv.js';
import { saveEarnings, type MarkupStats } from './_lib/earnings.js';

/**
 * One function for the operator platform (keeps us under Vercel's function limit and shares one warm DB pool).
 * vercel.json rewrites /api/(me|invites|network|billing)/... → /api/platform?group=...&rest=...
 *
 *   GET    /api/me                         who am I + billing state
 *   PUT    /api/me/settings                (owner) { price_kes, period_days }
 *   GET    /api/invites                    my invite links
 *   POST   /api/invites                    create a link { maxUses? }
 *   DELETE /api/invites?code=              revoke
 *   GET    /api/invites/info?code=         (public) who invited me
 *   GET    /api/network?q=&page=&scope=    people under me (owner: everyone)
 *   GET    /api/network/:id                details of one person under me
 *   POST   /api/network/:id                (owner) { action: suspend | activate | grant_days, days? }
 *   POST   /api/billing/stk                { phone } → M-Pesa STK push
 *   GET    /api/billing/payment?id=        payment status (settles via Daraja query if the callback is late)
 *   GET    /api/billing                    my payments
 *   POST   /api/billing/mpesa-callback?k=  Safaricom → us
 *   GET    /api/commissions?from=&to=      Deriv markup earnings (needs application_read)
 *   GET|POST /api/xmlbots, PATCH|DELETE /api/xmlbots/:id, GET /api/xmlbots/download?id=
 *   GET|POST /api/support, GET|POST /api/support/:id, GET|PUT /api/support/contacts
 *   GET|PUT /api/settings/profile
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const group = String(req.query.group ?? '');
  const rest = String(req.query.rest ?? '').replace(/^\/+|\/+$/g, '');
  try {
    // Safaricom's callback has no browser Origin and no session — handle it before CSRF checks.
    if (group === 'billing' && rest === 'mpesa-callback') return await mpesaCallback(req, res);
    // Public XML download (published bots only) — a plain link, so no Origin header.
    if (group === 'xmlbots' && rest === 'download') return await xmlDownload(req, res);

    if (req.method !== 'GET' && !(group === 'invites' && rest === 'info') && !sameOrigin(req)) {
      return res.status(403).json({ error: 'bad_origin' });
    }
    switch (group) {
      case 'me': return await me(req, res, rest);
      case 'invites': return await invites(req, res, rest);
      case 'network': return await network(req, res, rest);
      case 'billing': return await billing(req, res, rest);
      case 'commissions': return await commissions(req, res);
      case 'xmlbots': return await xmlBots(req, res, rest);
      case 'support': return await support(req, res, rest);
      case 'settings': return await settingsRoute(req, res, rest);
      default: return res.status(404).json({ error: 'not_found' });
    }
  } catch (e) {
    console.error('platform', group, rest, e);
    return res.status(500).json({ error: 'server_error' });
  }
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* ------------------------------------------------------------------ me */

async function me(req: VercelRequest, res: VercelResponse, rest: string) {
  if (rest === 'settings') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
    const owner = await requireOwner(req, res);
    if (!owner) return;
    const b = (req.body ?? {}) as { price_kes?: unknown; period_days?: unknown };
    const price = Number(b.price_kes), days = Number(b.period_days);
    if (!Number.isInteger(price) || price < 0 || price > 1_000_000) return res.status(422).json({ error: 'invalid_price' });
    if (!Number.isInteger(days) || days < 1 || days > 366) return res.status(422).json({ error: 'invalid_period' });
    await query(`insert into settings (key, value, updated_at) values ('billing', $1, now())
                 on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify({ price_kes: price, period_days: days })]);
    await audit(owner.id, 'settings.billing', null, { price_kes: price, period_days: days });
    return res.status(200).json({ billing: await getBilling(true) });
  }
  if (req.method !== 'GET' || rest) return res.status(404).json({ error: 'not_found' });
  const op = await requireOperator(req, res);
  if (!op) return;
  const bill = await getBilling();
  const [parent] = await query<{ name: string | null; subdomain: string | null }>(
    `select s.name, s.subdomain from sites s where s.operator_id = $1`, [op.parent_id],
  );
  return res.status(200).json({
    operator: { id: op.id, role: op.role, status: op.status, paidUntil: op.paid_until, parent: op.parent_id ? (parent ?? { name: null, subdomain: null }) : null },
    billing: { priceKes: bill.price_kes, periodDays: bill.period_days, required: bill.price_kes > 0 && op.role !== 'owner', active: hasAccess(op, bill), mpesa: mpesaConfigured() },
  });
}

/* ------------------------------------------------------------------ invites */

async function invites(req: VercelRequest, res: VercelResponse, rest: string) {
  if (rest === 'info') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (!(await rateLimit(`invite-info:${clientIp(req)}`, 60, 600))) return res.status(429).json({ error: 'too_many_requests' });
    const code = String(req.query.code ?? '');
    if (!/^[A-Za-z0-9_-]{10,40}$/.test(code)) return res.status(200).json({ valid: false });
    const [row] = await query<{ name: string | null }>(
      `select s.name from invites i join operators o on o.id = i.operator_id left join sites s on s.operator_id = o.id
        where i.code = $1 and not i.revoked and i.expires_at > now() and i.uses < i.max_uses and o.status = 'active'`, [code],
    );
    return res.status(200).json(row ? { valid: true, inviter: row.name ?? 'a Mwasya operator' } : { valid: false });
  }

  const op = await requireOperator(req, res);
  if (!op) return;

  if (req.method === 'GET') {
    const list = await query(
      `select code, max_uses, uses, revoked, expires_at, created_at from invites where operator_id = $1 order by created_at desc limit 50`, [op.id],
    );
    return res.status(200).json({ invites: list });
  }
  if (req.method === 'POST') {
    if (!hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    if (!(await rateLimit(`invite-create:${op.id}`, 20, 3600))) return res.status(429).json({ error: 'too_many_requests' });
    const [{ n }] = await query<{ n: string }>(`select count(*) n from invites where operator_id = $1 and not revoked and expires_at > now()`, [op.id]);
    if (Number(n) >= 20) return res.status(409).json({ error: 'too_many_invites' });
    const maxUses = Math.min(1000, Math.max(1, Math.floor(Number((req.body ?? {}).maxUses ?? 100)) || 100));
    const code = randomBytes(12).toString('base64url');
    const [inv] = await query(
      `insert into invites (code, operator_id, max_uses) values ($1, $2, $3) returning code, max_uses, uses, revoked, expires_at, created_at`,
      [code, op.id, maxUses],
    );
    await audit(op.id, 'invite.create', null, { code });
    return res.status(201).json({ invite: inv });
  }
  if (req.method === 'DELETE') {
    const code = String(req.query.code ?? '');
    const rows = await query(`update invites set revoked = true where code = $1 and operator_id = $2 returning code`, [code, op.id]);
    if (rows.length) await audit(op.id, 'invite.revoke', null, { code });
    return rows.length ? res.status(204).end() : res.status(404).json({ error: 'not_found' });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

/* ------------------------------------------------------------------ network */

const PAGE_SIZE = 25;

async function network(req: VercelRequest, res: VercelResponse, rest: string) {
  const op = await requireOperator(req, res);
  if (!op) return;

  if (!rest) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    const like = q ? `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%` : '';
    const page = Math.max(1, Math.min(1000, Math.floor(Number(req.query.page ?? 1)) || 1));
    const direct = req.query.scope === 'direct';
    const status = ['active', 'suspended'].includes(String(req.query.status)) ? String(req.query.status) : '';

    // Owner sees everyone; operators see their own subtree. Depth-limited recursive walk, indexed on parent_id.
    const rows = await query(
      `with recursive tree as (
         select id, 0 as depth from operators where id = $1
         union all
         select o.id, t.depth + 1 from operators o join tree t on o.parent_id = t.id where t.depth < 25
       )
       select o.id, o.parent_id, t.depth, o.role, o.status, o.paid_until, o.created_at, o.last_login_at,
              s.name as site_name, s.subdomain, s.status as site_status,
              ps.name as parent_site, ps.subdomain as parent_subdomain,
              (select string_agg(a.account_id, ', ' order by a.account_type) from operator_accounts a where a.operator_id = o.id) as accounts,
              (select count(*) from bots b where b.operator_id = o.id and b.status = 'published')::int as bots_published,
              (select count(*) from operators c where c.parent_id = o.id)::int as direct_children,
              e.markup_30d::float as markup_30d, e.fetched_at as earnings_at, s.custom_domain,
              count(*) over ()::int as total
         from tree t
         join operators o on o.id = t.id
         left join sites s on s.operator_id = o.id
         left join sites ps on ps.operator_id = o.parent_id
         left join operator_earnings e on e.operator_id = o.id
        where t.depth > 0
          and ($2::boolean is false or t.depth = 1)
          and ($3 = '' or o.status = $3)
          and ($4 = '' or s.name ilike $4 or s.subdomain ilike $4
               or exists (select 1 from operator_accounts a where a.operator_id = o.id and a.account_id ilike $4))
        order by o.created_at desc
        limit $5 offset $6`,
      [op.id, direct, status, like, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    );
    const [summary] = await query<{ people: number; sites: number; suspended: number; paying: number; markup_30d: number }>(
      `with recursive tree as (
         select id, 0 as depth from operators where id = $1
         union all
         select o.id, t.depth + 1 from operators o join tree t on o.parent_id = t.id where t.depth < 25
       )
       select count(*) filter (where t.depth > 0)::int as people,
              count(s.id) filter (where t.depth > 0)::int as sites,
              count(*) filter (where t.depth > 0 and o.status = 'suspended')::int as suspended,
              count(*) filter (where t.depth > 0 and o.paid_until > now())::int as paying,
              coalesce(sum(e.markup_30d) filter (where t.depth > 0), 0)::float as markup_30d
         from tree t join operators o on o.id = t.id left join sites s on s.operator_id = o.id
         left join operator_earnings e on e.operator_id = o.id`,
      [op.id],
    );
    const total = (rows[0] as { total?: number } | undefined)?.total ?? 0;
    return res.status(200).json({ people: rows, page, pageSize: PAGE_SIZE, total, summary });
  }

  const id = rest;
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  // Only people in my subtree (owner: everyone).
  const [inTree] = await query(
    `with recursive up as (
       select id, parent_id, 0 as d from operators where id = $2
       union all select o.id, o.parent_id, up.d + 1 from operators o join up on o.id = up.parent_id where up.d < 25
     ) select 1 from up where id = $1 and $1 <> $2 limit 1`, [op.id, id],
  );
  if (!inTree) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') {
    const [person] = await query(
      `select o.id, o.role, o.status, o.paid_until, o.created_at, o.last_login_at, case when $2 then o.phone end as phone,
              s.name as site_name, s.subdomain, s.status as site_status, s.deriv_app_id, s.markup,
              ps.name as parent_site
         from operators o left join sites s on s.operator_id = o.id left join sites ps on ps.operator_id = o.parent_id
        where o.id = $1`, [id, op.role === 'owner'],
    );
    const [earnings] = await query(`select markup_30d::float, volume_30d::float, contracts_30d, clients_30d, breakdown, fetched_at from operator_earnings where operator_id = $1`, [id]);
    const accounts = await query(`select account_id, account_type, currency, seen_at from operator_accounts where operator_id = $1 order by account_type`, [id]);
    const bots = await query(`select id, name, risk, status, updated_at from bots where operator_id = $1 and status <> 'archived' order by updated_at desc limit 50`, [id]);
    const payments = op.role === 'owner'
      ? await query(`select id, amount, status, mpesa_receipt, phone, created_at from payments where operator_id = $1 order by created_at desc limit 20`, [id])
      : [];
    const history = op.role === 'owner'
      ? await query(`select action, meta, created_at from audit_log where target_id = $1 order by created_at desc limit 20`, [id])
      : [];
    return res.status(200).json({ person, accounts, bots, payments, history, earnings: earnings ?? null });
  }

  if (req.method === 'POST') {
    if (op.role !== 'owner') return res.status(403).json({ error: 'owner_only' });
    const b = (req.body ?? {}) as { action?: unknown; days?: unknown };
    const [target] = await query<Operator>(`select id, role, status, paid_until, parent_id from operators where id = $1`, [id]);
    if (!target || target.role === 'owner') return res.status(404).json({ error: 'not_found' });
    if (b.action === 'suspend' || b.action === 'activate') {
      const status = b.action === 'suspend' ? 'suspended' : 'active';
      await query(`update operators set status = $2 where id = $1`, [id, status]);
      await audit(op.id, `operator.${b.action}`, id);
      return res.status(200).json({ ok: true, status });
    }
    if (b.action === 'grant_days') {
      const days = Math.floor(Number(b.days));
      if (!(days >= 1 && days <= 366)) return res.status(422).json({ error: 'invalid_days' });
      const [row] = await query<{ paid_until: string }>(
        `update operators set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => $2) where id = $1 returning paid_until`, [id, days],
      );
      await audit(op.id, 'operator.grant_days', id, { days });
      return res.status(200).json({ ok: true, paidUntil: row.paid_until });
    }
    return res.status(422).json({ error: 'invalid_action' });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

/* ------------------------------------------------------------------ billing (M-Pesa) */

/** Settle a pending payment exactly once; on success extend the operator's access. */
async function settle(paymentId: string, outcome: StkOutcome, receipt?: string) {
  if (outcome.state === 'pending') return;
  const client = await db().connect();
  try {
    await client.query('begin');
    const up = await client.query<{ operator_id: string; period_days: number; amount: number }>(
      `update payments set status = $2, result_code = $3, result_desc = $4, mpesa_receipt = coalesce($5, mpesa_receipt), updated_at = now()
        where id = $1 and status = 'pending' returning operator_id, period_days, amount`,
      [paymentId, outcome.state, outcome.resultCode ?? null, (outcome.resultDesc ?? '').slice(0, 200), receipt ?? null],
    );
    const p = up.rows[0];
    if (p && outcome.state === 'paid') {
      await client.query(
        `update operators set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => $2) where id = $1`,
        [p.operator_id, p.period_days],
      );
      await client.query(`insert into audit_log (actor_id, action, target_id, meta) values ($1, 'payment.paid', $1, $2)`,
        [p.operator_id, JSON.stringify({ paymentId, amount: p.amount, receipt })]);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

async function billing(req: VercelRequest, res: VercelResponse, rest: string) {
  const op = await requireOperator(req, res);
  if (!op) return;

  if (rest === 'stk') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const bill = await getBilling(true);
    if (bill.price_kes <= 0 || op.role === 'owner') return res.status(400).json({ error: 'no_payment_needed' });
    if (!mpesaConfigured()) return res.status(503).json({ error: 'mpesa_not_configured' });
    const phone = normalizePhone(String((req.body ?? {}).phone ?? ''));
    if (!phone) return res.status(422).json({ error: 'invalid_phone' });
    if (!(await rateLimit(`stk:${op.id}`, 5, 600))) return res.status(429).json({ error: 'too_many_requests' });

    const [p] = await query<{ id: string }>(
      `insert into payments (operator_id, phone, amount, period_days) values ($1, $2, $3, $4) returning id`,
      [op.id, phone, bill.price_kes, bill.period_days],
    );
    try {
      const r = await stkPush({ phone, amount: bill.price_kes, reference: 'MWASYA', description: 'Mwasya access' });
      await query(`update payments set merchant_request_id = $2, checkout_request_id = $3, updated_at = now() where id = $1`,
        [p.id, r.merchantRequestId, r.checkoutRequestId]);
      await query(`update operators set phone = $2 where id = $1`, [op.id, phone]);
      return res.status(200).json({ id: p.id, message: r.customerMessage ?? 'Check your phone and enter your M-Pesa PIN.' });
    } catch (e) {
      await query(`update payments set status = 'failed', result_desc = $2, updated_at = now() where id = $1`, [p.id, String((e as Error).message).slice(0, 200)]);
      return res.status(502).json({ error: 'mpesa_error' });
    }
  }

  if (rest === 'payment') {
    const id = String(req.query.id ?? '');
    if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
    const [p] = await query<{ id: string; status: string; checkout_request_id: string | null; created_at: string; amount: number; mpesa_receipt: string | null; result_desc: string | null }>(
      `select id, status, checkout_request_id, created_at, amount, mpesa_receipt, result_desc from payments where id = $1 and operator_id = $2`, [id, op.id],
    );
    if (!p) return res.status(404).json({ error: 'not_found' });
    // Callback late or missing? Ask Safaricom directly (after the customer had time to answer).
    if (p.status === 'pending' && p.checkout_request_id && Date.now() - new Date(p.created_at).getTime() > 20_000) {
      try {
        const outcome = await stkQuery(p.checkout_request_id);
        await settle(p.id, outcome);
        if (outcome.state !== 'pending') p.status = outcome.state;
      } catch { /* try again on the next poll */ }
      if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 5 * 60_000) {
        await settle(p.id, { state: 'failed', resultDesc: 'Timed out' });
        p.status = 'failed';
      }
    }
    const [fresh] = await query<{ paid_until: string | null }>(`select paid_until from operators where id = $1`, [op.id]);
    return res.status(200).json({ status: p.status, amount: p.amount, receipt: p.mpesa_receipt, paidUntil: fresh?.paid_until ?? null, message: p.result_desc });
  }

  if (!rest && req.method === 'GET') {
    const list = await query(`select id, amount, status, mpesa_receipt, created_at from payments where operator_id = $1 order by created_at desc limit 20`, [op.id]);
    return res.status(200).json({ payments: list });
  }
  return res.status(404).json({ error: 'not_found' });
}

async function mpesaCallback(req: VercelRequest, res: VercelResponse) {
  const ack = () => res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  if (req.method !== 'POST') return res.status(405).end();
  const expected = process.env.MPESA_CALLBACK_KEY ?? '';
  const got = String(req.query.k ?? '');
  if (!expected || got.length !== expected.length || !timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
    console.warn('mpesa callback: bad key from', clientIp(req));
    return res.status(403).end();
  }
  const cb = ((req.body ?? {}) as { Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number | string; ResultDesc?: string; CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] } } } }).Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return ack();
  const [p] = await query<{ id: string; amount: number; status: string }>(
    `select id, amount, status from payments where checkout_request_id = $1`, [cb.CheckoutRequestID],
  );
  if (!p || p.status !== 'pending') return ack();

  const items = Object.fromEntries((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value]));
  if (String(cb.ResultCode) === '0') {
    // Never trust the callback alone: confirm with Safaricom and check the amount.
    const confirmed = await stkQuery(cb.CheckoutRequestID).catch(() => ({ state: 'pending' as const }));
    const amountOk = Number(items.Amount ?? 0) >= p.amount;
    if (confirmed.state === 'paid' && amountOk) await settle(p.id, { ...confirmed }, items.MpesaReceiptNumber ? String(items.MpesaReceiptNumber) : undefined);
    else if (!amountOk) await settle(p.id, { state: 'failed', resultDesc: 'Amount mismatch' });
    // If Safaricom still says pending, the status poll will settle it shortly.
  } else {
    await settle(p.id, { state: String(cb.ResultCode) === '1032' ? 'cancelled' : 'failed', resultCode: String(cb.ResultCode), resultDesc: cb.ResultDesc });
  }
  return ack();
}

/* ------------------------------------------------------------------ commissions (Deriv markup statistics) */

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function commissions(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const op = await requireOperator(req, res);
  if (!op) return;
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'not_logged_in' });
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = re.test(String(req.query.to)) ? String(req.query.to) : ymd(new Date());
  const from = re.test(String(req.query.from)) ? String(req.query.from) : ymd(new Date(Date.now() - 29 * 864e5));
  if (from > to || (Date.parse(to) - Date.parse(from)) / 864e5 > 366) return res.status(422).json({ error: 'invalid_range' });
  if (!(await rateLimit(`commissions:${op.id}`, 30, 60))) return res.status(429).json({ error: 'too_many_requests' });

  const r = await derivFetch(`/applications/v1/markup-statistics?date_from=${from}&date_to=${to}`, s.accessToken);
  if (r.status === 401 || r.status === 403) return res.status(200).json({ needsScope: true });
  if (!r.ok) return res.status(502).json({ error: 'deriv_error', status: r.status });
  const j = (await r.json()) as { data?: MarkupStats };
  // The default 30-day view doubles as the snapshot the owner/uplines see in Network.
  if (j.data && !req.query.from && !req.query.to) await saveEarnings(op.id, j.data).catch(() => undefined);
  return res.status(200).json({ from, to, data: j.data ?? null });
}

/* ------------------------------------------------------------------ XML bots (Deriv Bot strategies) */

/** Accept only Deriv Bot / Blockly XML; reject anything that could be active content. Never parsed server-side. */
function checkXml(xml: unknown): string | null {
  if (typeof xml !== 'string') return 'Choose an XML file';
  if (xml.length > 400_000) return 'File is too large (max 400 KB)';
  const t = xml.replace(/^﻿/, '').trimStart();
  if (!/^<xml[\s>]/i.test(t) && !/^<\?xml[^>]*\?>\s*<xml[\s>]/i.test(t)) return 'This is not a Deriv Bot XML file';
  if (!/xmlns="(https?:\/\/developers\.google\.com\/blockly\/xml|http:\/\/www\.w3\.org\/1999\/xhtml)"/.test(t)) return 'This is not a Deriv Bot XML file';
  if (/<!DOCTYPE|<!ENTITY|<script|javascript:|<iframe|\son\w+\s*=\s*["']/i.test(t)) return 'File contains content that is not allowed';
  return null;
}

const XML_COLS = 'id, name, description, status, downloads, length(xml) as size, created_at, updated_at';

async function xmlBots(req: VercelRequest, res: VercelResponse, rest: string) {
  const op = await requireOperator(req, res);
  if (!op) return;
  const id = rest;

  if (!id && req.method === 'GET') {
    const list = await query(`select ${XML_COLS} from xml_bots where operator_id = $1 order by updated_at desc limit 200`, [op.id]);
    return res.status(200).json({ bots: list });
  }
  if (!id && req.method === 'POST') {
    if (!(await rateLimit(`xml-upload:${op.id}`, 30, 3600))) return res.status(429).json({ error: 'Too many uploads. Try again later.' });
    const b = (req.body ?? {}) as { name?: unknown; description?: unknown; xml?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 80) : '';
    const description = typeof b.description === 'string' ? b.description.trim().slice(0, 500) : '';
    if (!name) return res.status(422).json({ error: 'Give the bot a name' });
    const bad = checkXml(b.xml);
    if (bad) return res.status(422).json({ error: bad });
    const [{ n }] = await query<{ n: string }>(`select count(*) n from xml_bots where operator_id = $1`, [op.id]);
    if (Number(n) >= 100) return res.status(409).json({ error: 'You can keep up to 100 XML bots' });
    const [bot] = await query(
      `insert into xml_bots (operator_id, name, description, xml) values ($1, $2, $3, $4) returning ${XML_COLS}`,
      [op.id, name, description, String(b.xml)]);
    return res.status(201).json({ bot });
  }
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  if (req.method === 'PATCH') {
    const b = (req.body ?? {}) as { status?: unknown; name?: unknown; description?: unknown };
    const status = b.status === 'published' || b.status === 'draft' ? b.status : null;
    if (status === 'published' && !hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    const [bot] = await query(
      `update xml_bots set status = coalesce($3, status),
              name = coalesce(nullif(left(trim($4), 80), ''), name),
              description = coalesce(left(trim($5), 500), description), updated_at = now()
        where id = $1 and operator_id = $2 returning ${XML_COLS}`,
      [id, op.id, status, typeof b.name === 'string' ? b.name : null, typeof b.description === 'string' ? b.description : null]);
    return bot ? res.status(200).json({ bot }) : res.status(404).json({ error: 'not_found' });
  }
  if (req.method === 'DELETE') {
    const rows = await query(`delete from xml_bots where id = $1 and operator_id = $2 returning id`, [id, op.id]);
    return rows.length ? res.status(204).end() : res.status(404).json({ error: 'not_found' });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

/** GET /api/xmlbots/download?id= — published bots for anyone; drafts only for their owner. Always an attachment. */
async function xmlDownload(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const id = String(req.query.id ?? '');
  if (!isUuid(id)) return res.status(404).end();
  if (!(await rateLimit(`xml-dl:${clientIp(req)}`, 120, 600))) return res.status(429).end();
  const me = getSession(req)?.operatorId ?? null;
  const [bot] = await query<{ name: string; xml: string }>(
    `update xml_bots b set downloads = downloads + case when b.status = 'published' then 1 else 0 end
       from operators o
      where b.id = $1 and o.id = b.operator_id and o.status = 'active' and (b.status = 'published' or b.operator_id = $2)
      returning b.name, b.xml`, [id, me]);
  if (!bot) return res.status(404).end();
  const file = (bot.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || 'bot').slice(0, 60);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${file}.xml"`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(bot.xml);
}

/* ------------------------------------------------------------------ support tickets */

async function support(req: VercelRequest, res: VercelResponse, rest: string) {
  const op = await requireOperator(req, res);
  if (!op) return;
  const owner = op.role === 'owner';

  if (rest === 'contacts') {
    if (req.method === 'GET') {
      const [row] = await query<{ value: Record<string, string> }>(`select value from settings where key = 'support'`);
      return res.status(200).json({ contacts: row?.value ?? {} });
    }
    if (req.method === 'PUT') {
      if (!owner) return res.status(403).json({ error: 'owner_only' });
      const b = (req.body ?? {}) as Record<string, unknown>;
      const clean = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : '');
      const value = {
        whatsapp: clean(b.whatsapp, /^\+?\d{9,15}$/),
        telegram: clean(b.telegram, /^@?[A-Za-z0-9_]{4,32}$/),
        email: clean(b.email, /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/),
      };
      await query(`insert into settings (key, value, updated_at) values ('support', $1, now())
                   on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(value)]);
      await audit(op.id, 'settings.support', null, {});
      return res.status(200).json({ contacts: value });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!rest && req.method === 'GET') {
    const status = ['open', 'answered', 'closed'].includes(String(req.query.status)) ? String(req.query.status) : '';
    const page = Math.max(1, Math.min(500, Math.floor(Number(req.query.page ?? 1)) || 1));
    const rows = await query(
      `select t.id, t.subject, t.status, t.created_at, t.updated_at, s.name as site_name, s.subdomain,
              (select string_agg(account_id, ', ') from operator_accounts a where a.operator_id = t.operator_id) as accounts,
              count(*) over ()::int as total
         from tickets t left join sites s on s.operator_id = t.operator_id
        where ($1::boolean or t.operator_id = $2) and ($3 = '' or t.status = $3)
        order by case t.status when 'open' then 0 when 'answered' then 1 else 2 end, t.updated_at desc
        limit 25 offset $4`, [owner, op.id, status, (page - 1) * 25]);
    return res.status(200).json({ tickets: rows, page, total: (rows[0] as { total?: number } | undefined)?.total ?? 0 });
  }
  if (!rest && req.method === 'POST') {
    if (!(await rateLimit(`ticket:${op.id}`, 10, 3600))) return res.status(429).json({ error: 'Too many tickets. Try again later.' });
    const b = (req.body ?? {}) as { subject?: unknown; body?: unknown };
    const subject = typeof b.subject === 'string' ? b.subject.trim() : '';
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (subject.length < 3 || subject.length > 120) return res.status(422).json({ error: 'Subject must be 3 to 120 characters' });
    if (body.length < 1 || body.length > 4000) return res.status(422).json({ error: 'Message must be 1 to 4000 characters' });
    const [t] = await query<{ id: string }>(`insert into tickets (operator_id, subject) values ($1, $2) returning id`, [op.id, subject]);
    await query(`insert into ticket_messages (ticket_id, author_id, from_owner, body) values ($1, $2, $3, $4)`, [t.id, op.id, owner, body]);
    return res.status(201).json({ id: t.id });
  }

  const id = rest;
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  const [ticket] = await query<{ id: string; operator_id: string; subject: string; status: string }>(
    `select id, operator_id, subject, status from tickets where id = $1 and ($2::boolean or operator_id = $3)`, [id, owner, op.id]);
  if (!ticket) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') {
    const messages = await query(`select id, from_owner, body, created_at from ticket_messages where ticket_id = $1 order by id limit 200`, [id]);
    return res.status(200).json({ ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status }, messages });
  }
  if (req.method === 'POST') {
    const b = (req.body ?? {}) as { body?: unknown; status?: unknown };
    if (b.status === 'closed' || b.status === 'open') {
      await query(`update tickets set status = $2, updated_at = now() where id = $1`, [id, b.status]);
      return res.status(200).json({ ok: true });
    }
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (body.length < 1 || body.length > 4000) return res.status(422).json({ error: 'Message must be 1 to 4000 characters' });
    if (!(await rateLimit(`ticket-msg:${op.id}`, 60, 3600))) return res.status(429).json({ error: 'Too many messages. Try again later.' });
    const fromOwner = owner && ticket.operator_id !== op.id;
    await query(`insert into ticket_messages (ticket_id, author_id, from_owner, body) values ($1, $2, $3, $4)`, [id, op.id, fromOwner, body]);
    await query(`update tickets set status = $2, updated_at = now() where id = $1`, [id, fromOwner ? 'answered' : 'open']);
    return res.status(201).json({ ok: true });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

/* ------------------------------------------------------------------ settings (profile + language) */

async function settingsRoute(req: VercelRequest, res: VercelResponse, rest: string) {
  if (rest !== 'profile') return res.status(404).json({ error: 'not_found' });
  const op = await requireOperator(req, res);
  if (!op) return;
  if (req.method === 'GET') {
    const [p] = await query(`select display_name, contact, language from operators where id = $1`, [op.id]);
    return res.status(200).json({ profile: p });
  }
  if (req.method === 'PUT') {
    const b = (req.body ?? {}) as { display_name?: unknown; contact?: unknown; language?: unknown };
    const name = typeof b.display_name === 'string' ? b.display_name.trim().slice(0, 60) : '';
    const contact = typeof b.contact === 'string' ? b.contact.trim().slice(0, 120) : '';
    const language = ['en', 'sw', 'fr'].includes(String(b.language)) ? String(b.language) : 'en';
    if (/[<>]/.test(name + contact)) return res.status(422).json({ error: 'Remove < and > characters' });
    const [p] = await query(
      `update operators set display_name = nullif($2, ''), contact = nullif($3, ''), language = $4 where id = $1
       returning display_name, contact, language`, [op.id, name, contact, language]);
    return res.status(200).json({ profile: p });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
