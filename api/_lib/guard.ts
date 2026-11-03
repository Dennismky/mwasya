import type { VercelRequest, VercelResponse } from '@vercel/node';
import { query } from './db.js';
import { getSession } from './session.js';

/** ---------- Rate limiting (fixed window, stored in Postgres so it works across instances) ---------- */
export async function rateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  const [row] = await query<{ count: number }>(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning count`,
    [key, windowSec],
  );
  return row.count <= max;
}

export function clientIp(req: VercelRequest): string {
  // Vercel sets x-vercel-forwarded-for itself (clients can't spoof it); fall back for local dev.
  const vercel = String(req.headers['x-vercel-forwarded-for'] ?? '').split(',')[0].trim();
  if (vercel) return vercel;
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] ?? 'unknown');
}

/** ---------- Billing ---------- */
export interface Billing { price_kes: number; period_days: number }
let billingCache: { at: number; v: Billing } | undefined;

export async function getBilling(fresh = false): Promise<Billing> {
  if (!fresh && billingCache && Date.now() - billingCache.at < 60_000) return billingCache.v;
  const [row] = await query<{ value: Billing }>(`select value from settings where key = 'billing'`);
  const v = { price_kes: Math.max(0, Math.floor(Number(row?.value?.price_kes ?? 0))), period_days: Math.max(1, Math.floor(Number(row?.value?.period_days ?? 30))) };
  billingCache = { at: Date.now(), v };
  return v;
}

/** ---------- Operator auth (checks the database on every call, so suspensions apply instantly) ---------- */
export interface Operator {
  id: string;
  role: 'owner' | 'operator';
  status: 'active' | 'suspended';
  paid_until: string | null;
  parent_id: string | null;
}

export function hasAccess(op: Operator, billing: Billing): boolean {
  if (op.role === 'owner') return true;
  if (billing.price_kes <= 0) return true;
  return !!op.paid_until && new Date(op.paid_until).getTime() > Date.now();
}

/** Returns the logged-in, active operator, or sends 401/403 and returns null. */
export async function requireOperator(req: VercelRequest, res: VercelResponse): Promise<Operator | null> {
  const s = getSession(req);
  if (!s) { res.status(401).json({ error: 'not_logged_in' }); return null; }
  if (!s.operatorId) { res.status(401).json({ error: 'relogin_required' }); return null; }
  const [op] = await query<Operator>(`select id, role, status, paid_until, parent_id from operators where id = $1`, [s.operatorId]);
  if (!op) { res.status(401).json({ error: 'relogin_required' }); return null; }
  if (op.status !== 'active') { res.status(403).json({ error: 'suspended' }); return null; }
  return op;
}

export async function requireOwner(req: VercelRequest, res: VercelResponse): Promise<Operator | null> {
  const op = await requireOperator(req, res);
  if (!op) return null;
  if (op.role !== 'owner') { res.status(403).json({ error: 'owner_only' }); return null; }
  return op;
}

/** True if `targetId` is `ancestorId` itself or anywhere below it in the tree. */
export async function isInSubtree(ancestorId: string, targetId: string): Promise<boolean> {
  const rows = await query(
    `with recursive up as (
       select id, parent_id, 0 as depth from operators where id = $2
       union all
       select o.id, o.parent_id, up.depth + 1 from operators o join up on o.id = up.parent_id where up.depth < 50
     ) select 1 from up where id = $1 limit 1`,
    [ancestorId, targetId],
  );
  return rows.length > 0;
}

export async function audit(actorId: string | null, action: string, targetId: string | null, meta: Record<string, unknown> = {}) {
  await query(`insert into audit_log (actor_id, action, target_id, meta) values ($1, $2, $3, $4)`, [actorId, action, targetId, JSON.stringify(meta)]);
}
