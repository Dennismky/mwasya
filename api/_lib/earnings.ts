import { derivFetch } from './deriv.js';
import { query } from './db.js';

export interface MarkupStats {
  total_app_markup_usd?: number; total_volume_usd?: number; total_payout_usd?: number;
  total_contract_count?: number; total_client_count?: number; breakdown?: unknown[];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Save a mentor's last-30-day markup so the owner/uplines can see it. */
export async function saveEarnings(operatorId: string, d: MarkupStats): Promise<void> {
  await query(
    `insert into operator_earnings (operator_id, markup_30d, volume_30d, contracts_30d, clients_30d, breakdown, fetched_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (operator_id) do update set markup_30d = excluded.markup_30d, volume_30d = excluded.volume_30d,
       contracts_30d = excluded.contracts_30d, clients_30d = excluded.clients_30d, breakdown = excluded.breakdown, fetched_at = now()`,
    [operatorId, Number(d.total_app_markup_usd ?? 0), Number(d.total_volume_usd ?? 0), Math.round(Number(d.total_contract_count ?? 0)),
      Math.round(Number(d.total_client_count ?? 0)), JSON.stringify(Array.isArray(d.breakdown) ? d.breakdown.slice(0, 20) : [])],
  );
}

/** Fetch the last 30 days with the mentor's own token and store it. Returns null if the token can't read markup. */
export async function snapshotEarnings(operatorId: string, token: string): Promise<MarkupStats | null> {
  const to = ymd(new Date()), from = ymd(new Date(Date.now() - 29 * 864e5));
  const r = await derivFetch(`/applications/v1/markup-statistics?date_from=${from}&date_to=${to}`, token);
  if (!r.ok) return null;
  const j = (await r.json()) as { data?: MarkupStats };
  if (!j.data) return null;
  await saveEarnings(operatorId, j.data);
  return j.data;
}
