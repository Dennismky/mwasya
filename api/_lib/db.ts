import pg from 'pg';

/**
 * Postgres pool, reused across warm serverless invocations.
 * Use a pooled connection string in production (e.g. Neon "-pooler" host).
 */
let pool: pg.Pool | undefined;

export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({
      connectionString: url,
      max: 3,
      idleTimeoutMillis: 10_000,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db().query<T>(text, params);
  return r.rows;
}

export interface DerivAccount { account_id: string; account_type: 'demo' | 'real'; currency?: string }

/**
 * Find (or create) the operator who owns these Deriv accounts and record any new ones.
 * Returns the operator id.
 */
export async function upsertOperator(accounts: DerivAccount[], inviteCode?: string): Promise<string> {
  if (accounts.length === 0) throw new Error('no_accounts');
  const client = await db().connect();
  try {
    await client.query('begin');
    const ids = accounts.map((a) => a.account_id);
    const found = await client.query<{ operator_id: string }>(
      'select operator_id from operator_accounts where account_id = any($1) order by seen_at limit 1 for update',
      [ids],
    );
    let operatorId = found.rows[0]?.operator_id;
    if (operatorId) {
      // Existing operators never move in the tree (an invite link can't re-parent anyone).
      await client.query('update operators set last_login_at = now() where id = $1', [operatorId]);
    } else {
      // New operator: place under the inviter (valid, unused-up invite from an active operator), else under the owner.
      let parentId: string | null = null;
      if (inviteCode && /^[A-Za-z0-9_-]{10,40}$/.test(inviteCode)) {
        const inv = await client.query<{ operator_id: string }>(
          `update invites i set uses = uses + 1
             from operators o
            where i.code = $1 and o.id = i.operator_id and o.status = 'active'
              and not i.revoked and i.expires_at > now() and i.uses < i.max_uses
            returning i.operator_id`,
          [inviteCode],
        );
        parentId = inv.rows[0]?.operator_id ?? null;
      }
      if (!parentId) parentId = (await client.query<{ id: string }>(`select id from operators where role = 'owner' limit 1`)).rows[0]?.id ?? null;
      operatorId = (await client.query<{ id: string }>(
        'insert into operators (parent_id, last_login_at) values ($1, now()) returning id', [parentId],
      )).rows[0].id;
    }
    for (const a of accounts) {
      await client.query(
        `insert into operator_accounts (account_id, operator_id, account_type, currency)
         values ($1, $2, $3, $4)
         on conflict (account_id) do update set seen_at = now(), currency = excluded.currency`,
        [a.account_id, operatorId, a.account_type, a.currency ?? null],
      );
    }
    await client.query('commit');
    return operatorId;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
