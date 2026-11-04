import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, query } from './_lib/db.js';
import { audit, clientIp, getBilling, hasAccess, rateLimit, requireOperator, requireOwner, type Operator } from './_lib/guard.js';
import { mpesaConfigured, normalizePhone, stkPush, stkQuery, type StkOutcome } from './_lib/mpesa.js';
import { getSession, noStore, sameOrigin } from './_lib/session.js';
import { derivFetch } from './_lib/deriv.js';
import { saveEarnings, type MarkupStats } from './_lib/earnings.js';
import { addDomain, buyDomain, checkDomain, domainPrice, domainsConfigured, registrarOrder, removeDomain, searchDomains, type RegistrantContact } from './_lib/vercelDomains.js';
import { RESERVED_SUBDOMAINS, ROOT_DOMAIN } from './_lib/tenant.js';

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
    if (group === 'sites' && rest === 'logo') return await sitesRoute(req, res, rest);

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
      case 'domains': return await domains(req, res, rest);
      case 'sites': return await sitesRoute(req, res, rest);
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
    `select s.name, s.subdomain from operator_primary_site s where s.operator_id = $1`, [op.parent_id],
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
      `select s.name from invites i join operators o on o.id = i.operator_id left join operator_primary_site s on s.operator_id = o.id
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
         left join operator_primary_site s on s.operator_id = o.id
         left join operator_primary_site ps on ps.operator_id = o.parent_id
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
              coalesce(sum(s.site_count) filter (where t.depth > 0), 0)::int as sites,
              count(*) filter (where t.depth > 0 and o.status = 'suspended')::int as suspended,
              count(*) filter (where t.depth > 0 and o.paid_until > now())::int as paying,
              coalesce(sum(e.markup_30d) filter (where t.depth > 0), 0)::float as markup_30d
         from tree t join operators o on o.id = t.id left join operator_primary_site s on s.operator_id = o.id
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
         from operators o left join operator_primary_site s on s.operator_id = o.id left join operator_primary_site ps on ps.operator_id = o.parent_id
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
    const up = await client.query<{ operator_id: string; period_days: number; amount: number; purpose: string }>(
      `update payments set status = $2, result_code = $3, result_desc = $4, mpesa_receipt = coalesce($5, mpesa_receipt), updated_at = now()
        where id = $1 and status = 'pending' returning operator_id, period_days, amount, purpose`,
      [paymentId, outcome.state, outcome.resultCode ?? null, (outcome.resultDesc ?? '').slice(0, 200), receipt ?? null],
    );
    const p = up.rows[0];
    let domainOrder: string | undefined;
    if (p && outcome.state === 'paid' && p.purpose === 'access') {
      await client.query(
        `update operators set paid_until = greatest(coalesce(paid_until, now()), now()) + make_interval(days => $2) where id = $1`,
        [p.operator_id, p.period_days],
      );
    }
    if (p && p.purpose === 'domain') {
      const d = await client.query<{ id: string }>(
        `update domain_orders set status = $2, updated_at = now() where payment_id = $1 and status = 'awaiting_payment' returning id`,
        [paymentId, outcome.state === 'paid' ? 'paid' : 'cancelled']);
      if (outcome.state === 'paid') domainOrder = d.rows[0]?.id;
    }
    if (p && outcome.state === 'paid') {
      await client.query(`insert into audit_log (actor_id, action, target_id, meta) values ($1, 'payment.paid', $1, $2)`,
        [p.operator_id, JSON.stringify({ paymentId, amount: p.amount, receipt, purpose: p.purpose })]);
    }
    await client.query('commit');
    // Money is in: register the domain now (outside the payment transaction; idempotent).
    if (domainOrder) await processDomainOrder(domainOrder).catch((e) => console.error('domain order', domainOrder, e));
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

const XML_COLS = 'id, name, description, status, catalog, downloads, length(xml) as size, created_at, updated_at';

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
    const b = (req.body ?? {}) as { status?: unknown; name?: unknown; description?: unknown; catalog?: unknown };
    // Only the owner can put a bot in the shared catalog every mentor can offer.
    const catalog = op.role === 'owner' && typeof b.catalog === 'boolean' ? b.catalog : null;
    const status = b.status === 'published' || b.status === 'draft' ? b.status : null;
    if (status === 'published' && !hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    const [bot] = await query(
      `update xml_bots set status = coalesce($3, status), catalog = coalesce($6, catalog),
              name = coalesce(nullif(left(trim($4), 80), ''), name),
              description = coalesce(left(trim($5), 500), description), updated_at = now()
        where id = $1 and operator_id = $2 returning ${XML_COLS}`,
      [id, op.id, status, typeof b.name === 'string' ? b.name : null, typeof b.description === 'string' ? b.description : null, catalog]);
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
      where b.id = $1 and o.id = b.operator_id and o.status = 'active' and (b.status = 'published' or b.catalog or b.operator_id = $2)
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
         from tickets t left join operator_primary_site s on s.operator_id = t.operator_id
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

/* ------------------------------------------------------------------ domains (mentors buy a domain; we register + connect it) */

interface DomainSettings { enabled: boolean; kes_per_usd: number; margin_pct: number; max_usd: number }
async function domainSettings(): Promise<DomainSettings> {
  const [row] = await query<{ value: Partial<DomainSettings> }>(`select value from settings where key = 'domains'`);
  const v = row?.value ?? {};
  return {
    enabled: v.enabled === true,
    kes_per_usd: Math.max(1, Number(v.kes_per_usd ?? 130)),
    margin_pct: Math.min(500, Math.max(0, Number(v.margin_pct ?? 20))),
    max_usd: Math.max(1, Number(v.max_usd ?? 60)),
  };
}
const kesFor = (usd: number, s: DomainSettings) => Math.ceil((usd * s.kes_per_usd * (1 + s.margin_pct / 100)) / 10) * 10;
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const SUGGEST_TLDS = ['com', 'pro', 'net', 'online', 'site', 'trade', 'live', 'co'];

/** Advance a domain order: paid → buy at Vercel → poll → attach to the project and the mentor's site. Safe to call repeatedly. */
async function processDomainOrder(orderId: string): Promise<void> {
  const [o] = await query<{ id: string; operator_id: string; site_id: string | null; domain: string; years: number; usd_price: string; status: string; vercel_order_id: string | null; contact: RegistrantContact }>(
    `select id, operator_id, site_id, domain, years, usd_price, status, vercel_order_id, contact from domain_orders where id = $1`, [orderId]);
  if (!o) return;

  if (o.status === 'paid') {
    const price = await domainPrice(o.domain, o.years);
    const quoted = Number(o.usd_price);
    if (!price || !(price.purchase > 0)) {
      await query(`update domain_orders set status = 'needs_review', error = 'Price unavailable', updated_at = now() where id = $1`, [o.id]);
      return;
    }
    // Never pay more than we quoted (+2% rounding). Otherwise the owner decides.
    if (price.purchase > quoted * 1.02) {
      await query(`update domain_orders set status = 'needs_review', error = $2, updated_at = now() where id = $1`, [o.id, `Price rose to $${price.purchase}`]);
      return;
    }
    // Claim the order exactly once before spending money.
    const claimed = await query(`update domain_orders set status = 'purchasing', updated_at = now() where id = $1 and status = 'paid' returning id`, [o.id]);
    if (!claimed.length) return;
    const r = await buyDomain(o.domain, o.years, price.purchase, o.contact);
    if (!r.orderId) {
      await query(`update domain_orders set status = 'needs_review', error = $2, updated_at = now() where id = $1`, [o.id, `Registrar: ${r.error}`]);
      await audit(o.operator_id, 'domain.buy_failed', o.operator_id, { domain: o.domain, error: r.error });
      return;
    }
    await query(`update domain_orders set vercel_order_id = $2, updated_at = now() where id = $1`, [o.id, r.orderId]);
    await audit(o.operator_id, 'domain.buy', o.operator_id, { domain: o.domain, usd: price.purchase, orderId: r.orderId });
    o.status = 'purchasing'; o.vercel_order_id = r.orderId;
  }

  if (o.status === 'purchasing' && o.vercel_order_id) {
    const st = await registrarOrder(o.vercel_order_id);
    if (st.status === 'failed') {
      await query(`update domain_orders set status = 'needs_review', error = $2, updated_at = now() where id = $1`, [o.id, `Registration failed: ${st.error ?? 'unknown'}`]);
      return;
    }
    if (st.status !== 'completed') return; // still purchasing — checked again on the next status poll
    const attach = await addDomain(o.domain);
    const status = attach.verified && attach.configured ? 'verified' : 'pending';
    const [prev] = await query<{ custom_domain: string | null }>(`select custom_domain from sites where id = $1 and operator_id = $2`, [o.site_id, o.operator_id]);
    if (prev?.custom_domain && prev.custom_domain !== o.domain) await removeDomain(prev.custom_domain).catch(() => undefined);
    await query(`update sites set custom_domain = $3, domain_status = $4, domain_checked_at = now(), updated_at = now() where id = $1 and operator_id = $2`, [o.site_id, o.operator_id, o.domain, status]);
    await query(`update domain_orders set status = 'completed', error = null, updated_at = now() where id = $1`, [o.id]);
    await audit(o.operator_id, 'domain.connected', o.operator_id, { domain: o.domain });
  }
}

async function domains(req: VercelRequest, res: VercelResponse, rest: string) {
  const op = await requireOperator(req, res);
  if (!op) return;
  const owner = op.role === 'owner';
  const cfg = await domainSettings();

  if (rest === 'settings') {
    if (req.method === 'GET') return res.status(200).json({ settings: cfg, configured: domainsConfigured() });
    if (req.method !== 'PUT') return res.status(405).json({ error: 'method_not_allowed' });
    if (!owner) return res.status(403).json({ error: 'owner_only' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const next: DomainSettings = {
      enabled: b.enabled === true,
      kes_per_usd: Math.min(10_000, Math.max(1, Number(b.kes_per_usd) || cfg.kes_per_usd)),
      margin_pct: Math.min(500, Math.max(0, Number(b.margin_pct) || 0)),
      max_usd: Math.min(500, Math.max(1, Number(b.max_usd) || cfg.max_usd)),
    };
    await query(`insert into settings (key, value, updated_at) values ('domains', $1, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(next)]);
    await audit(op.id, 'settings.domains', null, next as unknown as Record<string, unknown>);
    return res.status(200).json({ settings: next });
  }

  if (rest === 'search') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    if (!cfg.enabled || !domainsConfigured()) return res.status(503).json({ error: 'Buying domains is not enabled yet.' });
    if (!(await rateLimit(`domain-search:${op.id}`, 30, 600))) return res.status(429).json({ error: 'Too many searches. Wait a few minutes.' });
    const q = String(req.query.q ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const [label, ...tldParts] = q.split('.');
    if (!NAME_RE.test(label ?? '') || /deriv|binary/.test(label)) return res.status(422).json({ error: 'Use letters, numbers and dashes, like statefx or statefx.pro' });
    const names = tldParts.length ? [q, ...SUGGEST_TLDS.map((t) => `${label}.${t}`).filter((n) => n !== q)] : SUGGEST_TLDS.map((t) => `${label}.${t}`);
    const results = await searchDomains(names.slice(0, 9));
    return res.status(200).json({
      results: results.map((r) => {
        const buyable = r.available && !r.premium && (r.price ?? 0) > 0 && (r.price ?? 0) <= cfg.max_usd;
        return { domain: r.domain, available: r.available, buyable, premium: r.premium, kes: buyable ? kesFor(r.price!, cfg) : null, renewKes: buyable && r.renewalPrice ? kesFor(r.renewalPrice, cfg) : null };
      }),
    });
  }

  if (rest === 'order') {
    if (req.method === 'GET') {
      const id = String(req.query.id ?? '');
      if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
      const [o] = await query<{ id: string; status: string }>(`select id, status from domain_orders where id = $1 and ($2::boolean or operator_id = $3)`, [id, owner, op.id]);
      if (!o) return res.status(404).json({ error: 'not_found' });
      if (o.status === 'paid' || o.status === 'purchasing') await processDomainOrder(o.id).catch((e) => console.error('domain poll', e));
      const [fresh] = await query(`select id, domain, status, kes_amount, error, payment_id, created_at, updated_at from domain_orders where id = $1`, [id]);
      return res.status(200).json({ order: fresh });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!cfg.enabled || !domainsConfigured()) return res.status(503).json({ error: 'Buying domains is not enabled yet.' });
    if (!hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    if (!(await rateLimit(`domain-order:${op.id}`, 5, 3600))) return res.status(429).json({ error: 'Too many orders. Try again later.' });
    const b = (req.body ?? {}) as { domain?: unknown; contact?: Record<string, unknown>; phone?: unknown; siteId?: unknown };
    const siteId = isUuid(b.siteId) ? b.siteId : null;
    const [site] = siteId ? await query(`select 1 from sites where id = $1 and operator_id = $2`, [siteId, op.id]) : [];
    if (!site) return res.status(409).json({ error: 'Choose which of your sites this domain is for.' });
    const domain = String(b.domain ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9-]{2,24})+$/.test(domain) || /deriv|binary/.test(domain)) return res.status(422).json({ error: 'Invalid domain' });
    const c = b.contact ?? {};
    const s = (k: string, max = 100) => (typeof c[k] === 'string' ? String(c[k]).trim().slice(0, max) : '');
    const mpesa = normalizePhone(String(b.phone ?? s('phone')));
    const contact: RegistrantContact = {
      firstName: s('firstName', 50), lastName: s('lastName', 50), email: s('email', 120), phone: mpesa ? `+${mpesa}` : s('phone', 20),
      address1: s('address1', 120), city: s('city', 60), state: s('state', 60), zip: s('zip', 16) || '00100', country: (s('country', 2) || 'KE').toUpperCase(),
      ...(s('companyName') ? { companyName: s('companyName', 100) } : {}),
    };
    const missing = (['firstName', 'lastName', 'email', 'address1', 'city', 'state'] as const).filter((k) => !contact[k]);
    if (missing.length) return res.status(422).json({ error: `Fill in: ${missing.join(', ')}` });
    if (!/^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,}$/.test(contact.email)) return res.status(422).json({ error: 'Enter a valid email' });
    if (!/^\+[1-9]\d{7,14}$/.test(contact.phone)) return res.status(422).json({ error: 'Enter a valid phone number' });
    if (!/^[A-Z]{2}$/.test(contact.country)) return res.status(422).json({ error: 'Country must be a 2-letter code like KE' });
    if (/[<>]/.test(Object.values(contact).join(''))) return res.status(422).json({ error: 'Remove < and > characters' });

    // Re-check availability and price on the server — never trust the browser's quote.
    const [avail] = await searchDomains([domain]);
    if (!avail?.available || avail.premium || !(avail.price && avail.price > 0)) return res.status(409).json({ error: 'That domain is no longer available.' });
    if (avail.price > cfg.max_usd) return res.status(409).json({ error: 'That domain is too expensive to buy here.' });
    const kes = kesFor(avail.price, cfg);
    const taken = await query(`select 1 from domain_orders where domain = $1 and status in ('awaiting_payment','paid','purchasing','completed','needs_review')`, [domain]);
    if (taken.length) return res.status(409).json({ error: 'Someone is already buying this domain.' });

    // The owner buys directly (charged to the Vercel team); everyone else pays with M-Pesa first.
    if (owner) {
      const [o] = await query<{ id: string }>(
        `insert into domain_orders (operator_id, domain, usd_price, kes_amount, contact, status, site_id) values ($1, $2, $3, 0, $4, 'paid', $5) returning id`,
        [op.id, domain, avail.price, JSON.stringify(contact), siteId]);
      await processDomainOrder(o.id).catch((e) => console.error('owner domain', e));
      return res.status(200).json({ orderId: o.id, paymentId: null });
    }
    if (!mpesaConfigured()) return res.status(503).json({ error: 'M-Pesa payments are not set up yet.' });
    if (!mpesa) return res.status(422).json({ error: 'Enter your Safaricom number for M-Pesa' });

    const [p] = await query<{ id: string }>(
      `insert into payments (operator_id, phone, amount, period_days, purpose) values ($1, $2, $3, 1, 'domain') returning id`, [op.id, mpesa, kes]);
    const [o] = await query<{ id: string }>(
      `insert into domain_orders (operator_id, domain, usd_price, kes_amount, payment_id, contact, site_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [op.id, domain, avail.price, kes, p.id, JSON.stringify(contact), siteId]);
    try {
      const r = await stkPush({ phone: mpesa, amount: kes, reference: 'DOMAIN', description: 'Domain' });
      await query(`update payments set merchant_request_id = $2, checkout_request_id = $3, updated_at = now() where id = $1`, [p.id, r.merchantRequestId, r.checkoutRequestId]);
      return res.status(200).json({ orderId: o.id, paymentId: p.id, kes, message: r.customerMessage ?? 'Check your phone and enter your M-Pesa PIN.' });
    } catch (e) {
      await query(`update payments set status = 'failed', result_desc = $2, updated_at = now() where id = $1`, [p.id, String((e as Error).message).slice(0, 200)]);
      await query(`update domain_orders set status = 'cancelled', error = 'M-Pesa prompt failed', updated_at = now() where id = $1`, [o.id]);
      return res.status(502).json({ error: 'Could not reach M-Pesa. Try again.' });
    }
  }

  if (!rest && req.method === 'GET') {
    // Owner: every order (to review problems). Mentors: their own.
    const list = await query(
      `select d.id, d.domain, d.status, d.kes_amount, d.usd_price::float, d.error, d.created_at, s.name as site_name
         from domain_orders d left join operator_primary_site s on s.operator_id = d.operator_id
        where ($1::boolean or d.operator_id = $2) order by d.created_at desc limit 50`, [owner, op.id]);
    return res.status(200).json({ orders: list });
  }
  if (rest === 'retry' && req.method === 'POST') {
    if (!owner) return res.status(403).json({ error: 'owner_only' });
    const id = String((req.body ?? {}).id ?? '');
    if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
    // Owner approved a review: put a paid order back in the queue at today's price.
    const [o] = await query<{ id: string; domain: string; years: number }>(`select id, domain, years from domain_orders where id = $1 and status = 'needs_review'`, [id]);
    if (!o) return res.status(404).json({ error: 'not_found' });
    const price = await domainPrice(o.domain, o.years);
    if (!price) return res.status(409).json({ error: 'Price unavailable' });
    await query(`update domain_orders set status = 'paid', usd_price = $2, error = null, vercel_order_id = null, updated_at = now() where id = $1`, [id, price.purchase]);
    await audit(op.id, 'domain.retry', null, { orderId: id, usd: price.purchase });
    await processDomainOrder(id).catch(() => undefined);
    const [fresh] = await query(`select id, domain, status, error from domain_orders where id = $1`, [id]);
    return res.status(200).json({ order: fresh });
  }
  return res.status(404).json({ error: 'not_found' });
}

/* ------------------------------------------------------------------ sites (many per mentor; built step by step) */

const FEATURES = ['bots', 'freebots', 'manual', 'charts', 'analysis', 'risk', 'learn', 'contact', 'deposit'] as const;
const TEMPLATES = ['bothub', 'signaldesk', 'chartfloor', 'primedesk', 'nightmarket'] as const;
const SITE_FULL = `id, name, subdomain, tagline, accent, theme, template, features, free_bots, deriv_app_id, markup::float as markup, status,
  custom_domain, domain_status, (logo is not null) as has_logo, created_at, updated_at`;

interface SiteFull {
  id: string; name: string; subdomain: string; tagline: string | null; accent: string; theme: string; template: string;
  features: string[]; free_bots: string[]; deriv_app_id: string | null; markup: number; status: 'draft' | 'live' | 'paused';
  custom_domain: string | null; domain_status: string; has_logo: boolean; created_at: string; updated_at: string;
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/deriv|binary/g, '').slice(0, 30) || 'site';

async function uniqueSubdomain(base: string): Promise<string> {
  let s = slugify(base);
  if (s.length < 3) s = `${s}-site`;
  if (RESERVED_SUBDOMAINS.has(s)) s = `${s}-site`;
  for (let i = 0; i < 6; i++) {
    const cand = i === 0 ? s : `${s}-${randomBytes(2).toString('hex')}`;
    const [hit] = await query(`select 1 from sites where subdomain = $1`, [cand]);
    if (!hit) return cand;
  }
  return `${s}-${randomBytes(4).toString('hex')}`;
}

function siteView(s: SiteFull) {
  const needs: string[] = [];
  if (!s.deriv_app_id) needs.push('deriv_app');
  if (s.custom_domain && s.domain_status !== 'verified') needs.push('dns');
  return {
    ...s,
    url: s.custom_domain && s.domain_status === 'verified' ? `https://${s.custom_domain}` : `https://${s.subdomain}.${ROOT_DOMAIN}`,
    subdomainUrl: `https://${s.subdomain}.${ROOT_DOMAIN}`,
    logoUrl: s.has_logo ? `/api/sites/logo?id=${s.id}&v=${Date.parse(s.updated_at)}` : null,
    needs,
  };
}

/** Accept only PNG/JPEG/WebP data URLs whose bytes really are that image type (≤ ~150 KB). */
function checkLogo(v: unknown): string | null | 'invalid' {
  if (v === null) return null;
  if (typeof v !== 'string') return 'invalid';
  const m = v.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m || v.length > 200_000) return 'invalid';
  const b = Buffer.from(m[2], 'base64');
  const ok = (m[1] === 'png' && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    || (m[1] === 'jpeg' && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (m[1] === 'webp' && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP');
  return ok ? v : 'invalid';
}

async function sitesRoute(req: VercelRequest, res: VercelResponse, rest: string) {
  // Public logo image (logos are public on trader sites anyway).
  if (rest === 'logo') {
    const id = String(req.query.id ?? '');
    if (!isUuid(id)) return res.status(404).end();
    const [row] = await query<{ logo: string | null }>(`select logo from sites where id = $1`, [id]);
    const m = row?.logo?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(Buffer.from(m[2], 'base64'));
  }

  const op = await requireOperator(req, res);
  if (!op) return;
  const [id, action] = rest.split('/');

  if (id === 'catalog') {
    // Bots a mentor can show on a site: the shared catalog + their own uploads.
    const list = await query(
      `select b.id, b.name, b.description, b.catalog, (b.operator_id = $1) as mine
         from xml_bots b join operators o on o.id = b.operator_id
        where (b.catalog and o.role = 'owner') or (b.operator_id = $1)
        order by b.catalog desc, b.name limit 300`, [op.id]);
    return res.status(200).json({ bots: list });
  }

  if (!id) {
    if (req.method === 'GET') {
      const status = ['draft', 'live', 'paused'].includes(String(req.query.status)) ? String(req.query.status) : '';
      const q = String(req.query.q ?? '').trim().slice(0, 60);
      const like = q ? `%${q.replace(/[%_\\]/g, (x) => '\\' + x)}%` : '';
      const rows = await query<SiteFull>(
        `select ${SITE_FULL} from sites where operator_id = $1 and ($2 = '' or status = $2)
            and ($3 = '' or name ilike $3 or subdomain ilike $3 or coalesce(custom_domain, '') ilike $3)
          order by created_at desc limit 100`, [op.id, status, like]);
      return res.status(200).json({ sites: rows.map(siteView) });
    }
    if (req.method === 'POST') {
      if (!(await rateLimit(`site-create:${op.id}`, 20, 3600))) return res.status(429).json({ error: 'Too many new sites. Try again later.' });
      const [{ n }] = await query<{ n: string }>(`select count(*) n from sites where operator_id = $1`, [op.id]);
      if (Number(n) >= 25) return res.status(409).json({ error: 'You can have up to 25 sites.' });
      const name = String((req.body ?? {}).name ?? '').trim().slice(0, 40);
      if (name.length < 2) return res.status(422).json({ error: 'Give your site a name (2 to 40 characters).' });
      if (/deriv|binary/i.test(name)) return res.status(422).json({ error: 'Deriv does not allow "Deriv" or "Binary" in site names.' });
      const sub = await uniqueSubdomain(name);
      const [site] = await query<SiteFull>(
        `insert into sites (operator_id, name, subdomain, status, markup) values ($1, $2, $3, 'draft', 0) returning ${SITE_FULL}`, [op.id, name, sub]);
      await audit(op.id, 'site.create', op.id, { siteId: site.id, name });
      return res.status(201).json({ site: siteView(site) });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  const [site] = await query<SiteFull>(`select ${SITE_FULL} from sites where id = $1 and operator_id = $2`, [id, op.id]);
  if (!site) return res.status(404).json({ error: 'not_found' });

  if (action === 'domain') return await siteDomain(req, res, op, site);

  if (action === 'publish' && req.method === 'POST') {
    if (!site.deriv_app_id) return res.status(422).json({ error: 'Add your Deriv App ID first.', step: 'deriv' });
    if (!hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    const [s] = await query<SiteFull>(`update sites set status = 'live', updated_at = now() where id = $1 returning ${SITE_FULL}`, [id]);
    await audit(op.id, 'site.publish', op.id, { siteId: id });
    return res.status(200).json({ site: siteView(s) });
  }
  if (action === 'unpublish' && req.method === 'POST') {
    const [s] = await query<SiteFull>(`update sites set status = 'paused', updated_at = now() where id = $1 returning ${SITE_FULL}`, [id]);
    return res.status(200).json({ site: siteView(s) });
  }
  if (action) return res.status(404).json({ error: 'not_found' });

  if (req.method === 'GET') return res.status(200).json({ site: siteView(site) });

  if (req.method === 'DELETE') {
    if (site.custom_domain) await removeDomain(site.custom_domain).catch(() => undefined);
    await query(`delete from sites where id = $1 and operator_id = $2`, [id, op.id]);
    await audit(op.id, 'site.delete', op.id, { siteId: id, name: site.name });
    return res.status(204).end();
  }

  if (req.method === 'PUT') {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length < 2 || name.length > 40) errors.name = 'Use 2 to 40 characters';
      else if (/deriv|binary/i.test(name)) errors.name = 'Deriv does not allow "Deriv" or "Binary" in names';
      else set('name', name);
    }
    if (b.subdomain !== undefined) {
      const sub = String(b.subdomain).trim().toLowerCase();
      if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(sub)) errors.subdomain = '3 to 40 letters, numbers or dashes';
      else if (RESERVED_SUBDOMAINS.has(sub) || /deriv|binary/.test(sub)) errors.subdomain = 'This address is not available';
      else {
        const [hit] = await query(`select 1 from sites where subdomain = $1 and id <> $2`, [sub, id]);
        if (hit) errors.subdomain = 'Someone already uses this address';
        else set('subdomain', sub);
      }
    }
    if (b.tagline !== undefined) {
      const t = String(b.tagline ?? '').trim().slice(0, 120);
      if (/[<>]/.test(t)) errors.tagline = 'Remove < and >'; else set('tagline', t || null);
    }
    if (b.accent !== undefined) { if (/^#[0-9A-Fa-f]{6}$/.test(String(b.accent))) set('accent', b.accent); else errors.accent = 'Pick a colour'; }
    if (b.theme !== undefined) set('theme', b.theme === 'dark' ? 'dark' : 'light');
    if (b.template !== undefined) { if ((TEMPLATES as readonly string[]).includes(String(b.template))) set('template', b.template); else errors.template = 'Pick a design'; }
    if (b.features !== undefined) {
      const f = Array.isArray(b.features) ? [...new Set(b.features.map(String))].filter((x) => (FEATURES as readonly string[]).includes(x)) : null;
      if (!f) errors.features = 'Invalid'; else set('features', JSON.stringify(f));
    }
    if (b.free_bots !== undefined) {
      const ids = Array.isArray(b.free_bots) ? [...new Set(b.free_bots.map(String))].filter(isUuid).slice(0, 200) : null;
      if (!ids) errors.free_bots = 'Invalid';
      else {
        // Only the shared catalog or this mentor's own uploads.
        const ok = ids.length ? await query<{ id: string }>(
          `select b.id from xml_bots b join operators o on o.id = b.operator_id
            where b.id = any($1::uuid[]) and ((b.catalog and o.role = 'owner') or b.operator_id = $2)`, [ids, op.id]) : [];
        set('free_bots', JSON.stringify(ok.map((r) => r.id)));
      }
    }
    if (b.logo !== undefined) {
      const l = checkLogo(b.logo);
      if (l === 'invalid') errors.logo = 'Use a PNG, JPG or WebP image under 150 KB'; else set('logo', l);
    }
    if (b.derivAppId !== undefined) {
      const appId = String(b.derivAppId ?? '').trim();
      if (!appId) set('deriv_app_id', null);
      else if (!/^[A-Za-z0-9_-]{2,64}$/.test(appId)) errors.derivAppId = 'Paste the App ID from your Deriv app';
      else if (appId === process.env.DERIV_APP_ID) errors.derivAppId = 'Use your own Deriv app, not Mwasya\'s, so markup is paid to you';
      else set('deriv_app_id', appId);
    }
    if (b.markup !== undefined) {
      const m = Math.round(Number(b.markup) * 2) / 2;
      if (!(m >= 0 && m <= 3)) errors.markup = 'Markup must be 0% to 3%'; else set('markup', m);
    }
    if (Object.keys(errors).length) return res.status(422).json({ error: 'invalid_site', errors });
    if (!sets.length) return res.status(200).json({ site: siteView(site) });
    const [s] = await query<SiteFull>(`update sites set ${sets.join(', ')}, updated_at = now() where id = $1 returning ${SITE_FULL}`, vals);
    return res.status(200).json({ site: siteView(s) });
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** /api/sites/:id/domain — POST { domain } connect one you own · GET re-check DNS · DELETE disconnect. */
async function siteDomain(req: VercelRequest, res: VercelResponse, op: Operator, site: SiteFull) {
  if (!domainsConfigured()) return res.status(503).json({ error: 'Custom domains are not enabled yet. Ask the platform owner.' });
  const verdict = (st: { verified: boolean; configured: boolean; error?: string }) => (st.error ? 'error' : st.verified && st.configured ? 'verified' : 'pending');
  if (req.method === 'POST') {
    if (!hasAccess(op, await getBilling())) return res.status(402).json({ error: 'payment_required' });
    if (!(await rateLimit(`domain:${op.id}`, 10, 3600))) return res.status(429).json({ error: 'Too many changes. Try again later.' });
    const d = String((req.body ?? {}).domain ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (d.length > 253 || !DOMAIN_RE.test(d)) return res.status(422).json({ error: 'Enter a domain like trade.yourbrand.com or yourbrand.com' });
    if (d === ROOT_DOMAIN || d.endsWith(`.${ROOT_DOMAIN}`) || /(^|\.)(vercel\.app|deriv\.com|deriv\.me|binary\.com)$/.test(d)) return res.status(422).json({ error: 'This domain cannot be used' });
    const [taken] = await query(`select 1 from sites where custom_domain = $1 and id <> $2`, [d, site.id]);
    if (taken) return res.status(409).json({ error: 'Another site already uses this domain' });
    if (site.custom_domain && site.custom_domain !== d) await removeDomain(site.custom_domain).catch(() => undefined);
    const st = await addDomain(d);
    await query(`update sites set custom_domain = $2, domain_status = $3, domain_checked_at = now(), updated_at = now() where id = $1`, [site.id, d, verdict(st)]);
    await audit(op.id, 'site.domain.add', op.id, { siteId: site.id, domain: d });
    return res.status(200).json({ domain: d, status: verdict(st), ...st });
  }
  if (!site.custom_domain) return res.status(200).json({ domain: null, status: 'none', records: [] });
  if (req.method === 'GET') {
    const st = await checkDomain(site.custom_domain);
    await query(`update sites set domain_status = $2, domain_checked_at = now() where id = $1`, [site.id, verdict(st)]);
    return res.status(200).json({ domain: site.custom_domain, status: verdict(st), ...st });
  }
  if (req.method === 'DELETE') {
    await removeDomain(site.custom_domain).catch(() => undefined);
    await query(`update sites set custom_domain = null, domain_status = 'none', updated_at = now() where id = $1`, [site.id]);
    await audit(op.id, 'site.domain.remove', op.id, { siteId: site.id, domain: site.custom_domain });
    return res.status(204).end();
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}
