import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BOT_COLUMNS, STATUSES, checkSpec, isUuid, requireOperator, type BotRow } from '../_lib/bots.js';
import { query } from '../_lib/db.js';
import { getSession, noStore, sameOrigin } from '../_lib/session.js';
import { burst } from '../_lib/burst.js';

/**
 * GET    /api/bots/:id                 → owner sees any status; anyone sees a published bot
 * PATCH  /api/bots/:id { spec?, status? }
 * DELETE /api/bots/:id                 → archives (keeps run history intact)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!burst(req, res, 'bots', 120)) return;
  noStore(res);
  const id = req.query.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });

  try {
    if (req.method === 'GET') {
      const operatorId = getSession(req)?.operatorId ?? null;
      const [bot] = await query<BotRow>(
        `select ${BOT_COLUMNS} from bots where id = $1 and (status = 'published' or operator_id = $2) and status <> 'archived'`,
        [id, operatorId],
      );
      return bot ? res.status(200).json({ bot }) : res.status(404).json({ error: 'not_found' });
    }

    if (req.method !== 'PATCH' && req.method !== 'DELETE') return res.status(405).json({ error: 'method_not_allowed' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
    const operatorId = await requireOperator(req, res);
    if (!operatorId) return;

    if (req.method === 'DELETE') {
      const rows = await query(`update bots set status = 'archived', updated_at = now() where id = $1 and operator_id = $2 returning id`, [id, operatorId]);
      return rows.length ? res.status(204).end() : res.status(404).json({ error: 'not_found' });
    }

    const body = (req.body ?? {}) as { spec?: unknown; status?: unknown };
    const sets: string[] = [];
    const params: unknown[] = [id, operatorId];
    if (body.spec !== undefined) {
      const result = await checkSpec(body.spec);
      if ('checks' in result) return res.status(422).json({ error: 'unsafe_bot', checks: result.checks });
      params.push(result.spec.name, JSON.stringify(result.spec), result.risk);
      sets.push(`name = $${params.length - 2}`, `spec = $${params.length - 1}`, `risk = $${params.length}`);
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as never) || body.status === 'archived') return res.status(400).json({ error: 'invalid_status' });
      params.push(body.status);
      sets.push(`status = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing_to_update' });

    const [bot] = await query<BotRow>(
      `update bots set ${sets.join(', ')}, updated_at = now() where id = $1 and operator_id = $2 and status <> 'archived' returning ${BOT_COLUMNS}`,
      params,
    );
    return bot ? res.status(200).json({ bot }) : res.status(404).json({ error: 'not_found' });
  } catch (e) {
    console.error('bot', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
