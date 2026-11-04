import { useCallback, useEffect, useRef, useState } from 'react';
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { accountSocket, type DerivSocket } from '../lib/derivWs';
import { symbolName } from './ticks';

type Tab = 'open' | 'statement' | 'profit';
interface OpenPos { contract_id: number; contract_type: string; symbol: string; buy_price: number; bid_price?: number; profit: number; is_valid_to_sell: boolean; purchase_time: number; display?: string }
interface Txn { transaction_id: number; action_type: string; amount: number; balance_after: number; contract_id?: number; transaction_time: number; longcode?: string }
interface Closed { contract_id: number; contract_type?: string; buy_price: number; sell_price: number; purchase_time: number; sell_time: number; longcode?: string; underlying_symbol?: string; shortcode?: string }

const PAGE = 25;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const when = (e: number) => new Date(e * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const money = (n: number) => `${n >= 0 ? '' : '−'}${Math.abs(n).toFixed(2)}`;

/** Deriv account reports: open positions (live), statement and profit table. */
export default function Reports() {
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const preview = account?.id === PREVIEW_ACCOUNT_ID;
  const [tab, setTab] = useState<Tab>('open');
  const ws = useRef<DerivSocket | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!account?.id || preview) return;
    const s = accountSocket(account.id);
    ws.current = s;
    setReady(true);
    return () => { s.close(); ws.current = null; setReady(false); };
  }, [account?.id, preview]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Reports</h1>
        <div className="seg" role="tablist" aria-label="Report" style={{ minWidth: 0 }}>
          {([['open', 'Open positions'], ['statement', 'Statement'], ['profit', 'Profit table']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </div>
      {preview ? <section className="card"><p className="muted">Clients see their own open trades, statement and profit table here once they log in.</p></section>
        : !ready || !ws.current ? <p className="muted"><span className="spinner" />Connecting…</p>
        : tab === 'open' ? <OpenPositions ws={ws.current} currency={currency} onChange={auth.refreshBalance} />
        : tab === 'statement' ? <Statement ws={ws.current} currency={currency} />
        : <ProfitTable ws={ws.current} currency={currency} />}
    </div>
  );
}

function OpenPositions({ ws, currency, onChange }: { ws: DerivSocket; currency: string; onChange: () => void }) {
  const [pos, setPos] = useState<Record<number, OpenPos>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    // One subscription streams every open contract on the account.
    ws.subscribe({ proposal_open_contract: 1 }, (m) => {
      if (!alive) return;
      setLoaded(true);
      const c = m.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c || typeof c.contract_id !== 'number') return;
      const id = c.contract_id;
      if (c.is_sold === 1) { setPos((p) => { const n = { ...p }; delete n[id]; return n; }); onChange(); return; }
      setPos((p) => ({ ...p, [id]: {
        contract_id: id, contract_type: String(c.contract_type ?? ''), symbol: String(c.underlying_symbol ?? c.underlying ?? ''),
        buy_price: num(c.buy_price), bid_price: num(c.bid_price), profit: num(c.profit), is_valid_to_sell: c.is_valid_to_sell === 1,
        purchase_time: num(c.purchase_time), display: String(c.display_name ?? ''),
      } }));
    }).then((u) => { off = u; }).catch((e: Error) => setError(e.message));
    // Portfolio gives the list immediately even before the first stream update.
    ws.send<{ portfolio?: { contracts?: Record<string, unknown>[] } }>({ portfolio: 1 }).then((r) => {
      if (!alive) return;
      setLoaded(true);
      setPos((p) => {
        const n = { ...p };
        for (const c of r.portfolio?.contracts ?? []) {
          const id = num(c.contract_id);
          n[id] ??= { contract_id: id, contract_type: String(c.contract_type ?? ''), symbol: String(c.underlying_symbol ?? c.symbol ?? ''), buy_price: num(c.buy_price), profit: 0, is_valid_to_sell: false, purchase_time: num(c.purchase_time) };
        }
        return n;
      });
    }).catch(() => undefined);
    return () => { alive = false; off?.(); };
  }, [ws, onChange]);

  const sell = async (id: number) => {
    try { await ws.send({ sell: id, price: 0 }); onChange(); } catch (e) { setError((e as Error).message); }
  };
  const list = Object.values(pos).sort((a, b) => b.purchase_time - a.purchase_time);
  const total = list.reduce((s, p) => s + p.profit, 0);

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{list.length} open position{list.length === 1 ? '' : 's'}</b>
        {list.length > 0 && <b className="mono" style={{ color: total >= 0 ? 'var(--success)' : 'var(--danger)' }}>{total >= 0 ? '+' : ''}{total.toFixed(2)} {currency}</b>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!loaded ? <p className="muted"><span className="spinner" />Loading…</p> : list.length === 0 ? <p className="muted">No open trades right now.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Contract</th><th>Market</th><th>Stake</th><th>Value now</th><th>Profit/loss</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.contract_id}>
                  <td><b>{p.contract_type}</b><div className="hint mono">#{p.contract_id}</div></td>
                  <td>{p.display || symbolName(p.symbol)}</td>
                  <td className="mono">{p.buy_price.toFixed(2)}</td>
                  <td className="mono">{p.bid_price ? p.bid_price.toFixed(2) : '—'}</td>
                  <td className="mono" style={{ color: p.profit >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}</td>
                  <td>{p.is_valid_to_sell && <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => sell(p.contract_id)}>Sell</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function usePaged<T>(load: (offset: number) => Promise<T[]>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const run = useCallback(() => {
    setRows(null); setError('');
    load(page * PAGE).then(setRows).catch((e: Error) => setError(e.message));
  }, [load, page]);
  useEffect(run, [run]);
  return { rows, page, setPage, error, reload: run };
}

function Pager({ page, setPage, count }: { page: number; setPage: (p: number) => void; count: number }) {
  return (
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
      <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</button>
      <span className="hint">Page {page + 1}</span>
      <button className="btn btn-secondary" disabled={count < PAGE} onClick={() => setPage(page + 1)}>Older</button>
    </div>
  );
}

function Statement({ ws, currency }: { ws: DerivSocket; currency: string }) {
  const load = useCallback(async (offset: number) => {
    const r = await ws.send<{ statement?: { transactions?: Record<string, unknown>[] } }>({ statement: 1, description: 1, limit: PAGE, offset });
    return (r.statement?.transactions ?? []).map((t) => ({
      transaction_id: num(t.transaction_id), action_type: String(t.action_type ?? ''), amount: num(t.amount), balance_after: num(t.balance_after),
      contract_id: t.contract_id ? num(t.contract_id) : undefined, transaction_time: num(t.transaction_time), longcode: t.longcode ? String(t.longcode) : undefined,
    }) as Txn);
  }, [ws]);
  const { rows, page, setPage, error } = usePaged(load);
  return (
    <section className="card stack" style={{ gap: 10 }}>
      {error && <p className="error" role="alert">{error}</p>}
      {!rows ? <p className="muted"><span className="spinner" />Loading…</p> : rows.length === 0 ? <p className="muted">No transactions yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Time</th><th>Type</th><th>Details</th><th>Amount</th><th>Balance</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.transaction_id}>
                  <td className="hint" style={{ whiteSpace: 'nowrap' }}>{when(t.transaction_time)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{t.action_type}</td>
                  <td className="hint" style={{ minWidth: 220 }}>{t.longcode ?? (t.contract_id ? `#${t.contract_id}` : '—')}</td>
                  <td className="mono" style={{ color: t.amount >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{money(t.amount)}</td>
                  <td className="mono">{t.balance_after.toFixed(2)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && <Pager page={page} setPage={setPage} count={rows.length} />}
    </section>
  );
}

function ProfitTable({ ws, currency }: { ws: DerivSocket; currency: string }) {
  const load = useCallback(async (offset: number) => {
    const r = await ws.send<{ profit_table?: { transactions?: Record<string, unknown>[] } }>({ profit_table: 1, description: 1, limit: PAGE, offset, sort: 'DESC' });
    return (r.profit_table?.transactions ?? []).map((t) => ({
      contract_id: num(t.contract_id), contract_type: t.contract_type ? String(t.contract_type) : undefined, buy_price: num(t.buy_price), sell_price: num(t.sell_price),
      purchase_time: num(t.purchase_time), sell_time: num(t.sell_time), longcode: t.longcode ? String(t.longcode) : undefined,
      underlying_symbol: t.underlying_symbol ? String(t.underlying_symbol) : undefined, shortcode: t.shortcode ? String(t.shortcode) : undefined,
    }) as Closed);
  }, [ws]);
  const { rows, page, setPage, error } = usePaged(load);
  const total = (rows ?? []).reduce((s, r) => s + (r.sell_price - r.buy_price), 0);
  return (
    <section className="card stack" style={{ gap: 10 }}>
      {error && <p className="error" role="alert">{error}</p>}
      {rows && rows.length > 0 && <b className="mono" style={{ color: total >= 0 ? 'var(--success)' : 'var(--danger)' }}>Page total: {total >= 0 ? '+' : ''}{total.toFixed(2)} {currency}</b>}
      {!rows ? <p className="muted"><span className="spinner" />Loading…</p> : rows.length === 0 ? <p className="muted">No closed trades yet.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Bought</th><th>Contract</th><th>Stake</th><th>Sold for</th><th>Profit/loss</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const pl = r.sell_price - r.buy_price;
                return (
                  <tr key={r.contract_id}>
                    <td className="hint" style={{ whiteSpace: 'nowrap' }}>{when(r.purchase_time)}</td>
                    <td style={{ minWidth: 200 }}><b>{r.contract_type ?? r.shortcode?.split('_')[0] ?? 'Contract'}</b><div className="hint">{r.longcode ?? (r.underlying_symbol ? symbolName(r.underlying_symbol) : '')}</div></td>
                    <td className="mono">{r.buy_price.toFixed(2)}</td>
                    <td className="mono">{r.sell_price.toFixed(2)}</td>
                    <td className="mono" style={{ color: pl >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{pl >= 0 ? '+' : ''}{pl.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && <Pager page={page} setPage={setPage} count={rows.length} />}
    </section>
  );
}
