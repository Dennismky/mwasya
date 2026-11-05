import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BOT_COLUMNS, checkSpec, requireOperator, type BotRow } from '../_lib/bots.js';
import { query } from '../_lib/db.js';
import { noStore, sameOrigin } from '../_lib/session.js';
import { burst } from '../_lib/burst.js';

/**
 * GET  /api/bots          → the operator's bots (not archived)
 * POST /api/bots { spec } → create a draft bot (422 with checks if unsafe)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!burst(req, res, 'bots', 120)) return;
  noStore(res);
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (req.method === 'POST' && !sameOrigin(req)) return res.status(403).json({ error: 'bad_origin' });
  const operatorId = await requireOperator(req, res);
  if (!operatorId) return;

  try {
    if (req.method === 'GET') {
      const bots = await query<BotRow>(
        `select ${BOT_COLUMNS} from bots where operator_id = $1 and status <> 'archived' order by updated_at desc limit 200`,
        [operatorId],
      );
      return res.status(200).json({ bots });
    }

    const result = await checkSpec((req.body ?? {}).spec);
    if ('checks' in result) return res.status(422).json({ error: 'unsafe_bot', checks: result.checks });
    const count = await query<{ n: string }>(`select count(*) as n from bots where operator_id = $1 and status <> 'archived'`, [operatorId]);
    if (Number(count[0].n) >= 200) return res.status(409).json({ error: 'too_many_bots' });

    const [bot] = await query<BotRow>(
      `insert into bots (operator_id, name, spec, risk) values ($1, $2, $3, $4) returning ${BOT_COLUMNS}`,
      [operatorId, result.spec.name, JSON.stringify(result.spec), result.risk],
    );
    return res.status(201).json({ bot });
  } catch (e) {
    console.error('bots', e);
    return res.status(500).json({ error: 'server_error' });
  }
}
