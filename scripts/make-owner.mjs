// Makes the operator who owns a Deriv account the platform owner (the root of the network),
// and places every operator without a parent under them.
// Usage: npm run make-owner -- <DERIV_ACCOUNT_ID>     e.g. npm run make-owner -- CR1234567
import pg from 'pg';

const accountId = process.argv[2];
if (!accountId || !/^[A-Z]{2,4}\d{3,12}$/.test(accountId)) {
  console.error('Usage: npm run make-owner -- <DERIV_ACCOUNT_ID>  (log in to mwasya.site once first)');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } });
await c.connect();
try {
  await c.query('begin');
  const { rows } = await c.query('select operator_id from operator_accounts where account_id = $1', [accountId]);
  if (!rows[0]) throw new Error(`No operator has Deriv account ${accountId}. Log in to mwasya.site with it first.`);
  const owner = rows[0].operator_id;
  await c.query(`update operators set role = 'operator' where role = 'owner' and id <> $1`, [owner]);
  await c.query(`update operators set role = 'owner', parent_id = null, status = 'active' where id = $1`, [owner]);
  const moved = await c.query(`update operators set parent_id = $1 where parent_id is null and id <> $1`, [owner]);
  await c.query(`insert into audit_log (actor_id, action, target_id, meta) values ($1, 'owner.set', $1, $2)`, [owner, JSON.stringify({ accountId })]);
  await c.query('commit');
  console.log(`Owner set (${accountId}). ${moved.rowCount} operator(s) placed under the owner.`);
} catch (e) {
  await c.query('rollback');
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
