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
export async function upsertOperator(accounts: DerivAccount[]): Promise<string> {
  if (accounts.length === 0) throw new Error('no_accounts');
  const client = await db().connect();
  try {
    await client.query('begin');
    const ids = accounts.map((a) => a.account_id);
    const found = await client.query<{ operator_id: string }>(
      'select operator_id from operator_accounts where account_id = any($1) order by seen_at limit 1 for update',
      [ids],
    );
    const operatorId = found.rows[0]?.operator_id
      ?? (await client.query<{ id: string }>('insert into operators default values returning id')).rows[0].id;
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
