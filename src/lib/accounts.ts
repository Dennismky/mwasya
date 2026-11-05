export interface Account { id: string; label: string; currency?: string; isVirtual?: boolean; balance?: number; active?: boolean }

/** Parse GET /api/deriv/accounts (https://developers.deriv.com/llms/get-accounts.md), defensively. */
export function parseAccounts(json: unknown): Account[] {
  const root = json as { data?: unknown; accounts?: unknown };
  const list = (Array.isArray(root?.data) ? root.data : Array.isArray(root?.accounts) ? root.accounts : Array.isArray(json) ? json : []) as Record<string, unknown>[];
  return list
    .map((a) => {
      const id = String(a.account_id ?? a.loginid ?? a.id ?? '');
      const currency = typeof a.currency === 'string' ? a.currency : undefined;
      const isVirtual = Boolean(a.is_virtual ?? a.is_demo ?? (a.account_type === 'demo'));
      const balance = typeof a.balance === 'number' ? a.balance : typeof a.balance === 'string' && a.balance !== '' ? Number(a.balance) : undefined;
      const active = a.status === undefined ? true : a.status === 'active';
      return { id, currency, isVirtual, balance: Number.isFinite(balance) ? balance : undefined, active, label: `${isVirtual ? 'Demo' : 'Real'}${currency ? ' · ' + currency : ''} · ${id}` };
    })
    .filter((a) => a.id);
}

export async function fetchAccounts(): Promise<Account[] | 'expired'> {
  const r = await fetch('/api/deriv/accounts', { credentials: 'same-origin' });
  if (r.status === 401) return 'expired';
  if (!r.ok) throw new Error('Could not load your Deriv accounts.');
  return parseAccounts(await r.json());
}
