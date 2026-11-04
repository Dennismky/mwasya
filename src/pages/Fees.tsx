import { useCallback, useEffect, useState } from 'react';

interface Row {
  operator_id: string; fee_mode: 'fixed' | 'percent' | 'none'; fee_kes: number; fee_pct: number; operator_status: string; phone: string | null;
  site_name: string | null; custom_domain: string | null; subdomain: string | null; site_count: number | null; accounts: string | null;
  commission_prev: number | null; commission_prev_at: string | null; commission_this: number | null; commission_30d: number | null;
  due_id: string | null; amount_usd: number | null; amount_kes: number | null; status: 'due' | 'pending_review' | 'paid' | 'waived' | null;
  paid_via: string | null; mpesa_code: string | null; paid_at: string | null; note: string | null;
}
interface Data { period: string; commissionMonth: string; window: { open: number; by: number; today: number; current: boolean }; rows: Row[]; summary: { expected: number; received: number; outstanding: number }; settings: { send_money_phone: string; send_money_name: string; kes_per_usd: number } }

const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const kes = (n: number) => `KES ${n.toLocaleString()}`;
const monthLabel = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const thisMonth = () => new Date().toISOString().slice(0, 7);
const STATUS = { due: 'Unpaid', pending_review: 'Check code', paid: 'Paid', waived: 'Waived' } as const;

/** Owner: every mentor's commission next to what they owe you and what they paid, per month. */
export default function Fees() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    fetch(`/api/dues?month=${month}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Only the platform owner can see this page.' : 'Could not load fees.'))))
      .then(setData).catch((e: Error) => setError(e.message));
  }, [month]);
  useEffect(load, [load]);

  const review = async (dueId: string, decision: 'approve' | 'reject' | 'waive' | 'reopen') => {
    let note: string | null = null;
    if (decision === 'reject') { note = prompt('Message to the mentor (optional):', 'We could not find this payment. Please check the code and try again.'); if (note === null) return; }
    if (decision === 'waive' && !confirm('Waive this month\'s fee? It will be marked as not owed.')) return;
    await fetch(`/api/dues/${dueId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ decision, note }) });
    load();
  };
  const issue = async (r: Row) => {
    const res = await fetch('/api/dues/issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ operatorId: r.operator_id }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) alert(j.error ?? 'Could not issue the fee.');
    load();
  };
  const suspend = async (r: Row) => {
    if (!confirm(`Suspend ${r.site_name ?? 'this mentor'}? Their sites go offline until you reactivate them in Network.`)) return;
    await fetch(`/api/network/${r.operator_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: r.operator_status === 'suspended' ? 'activate' : 'suspend' }) });
    load();
  };

  const rows = (data?.rows ?? []).filter((r) => !q || [r.site_name, r.custom_domain, r.subdomain, r.accounts, r.mpesa_code].some((x) => x?.toLowerCase().includes(q.toLowerCase())));
  const late = !!data && (!data.window.current || data.window.today > data.window.by);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>Mentor fees</h1>
          <p className="muted">Each mentor's commission next to what they owe you and what they paid. Fees fall due on the {data?.window.open ?? 10}th–{data?.window.by ?? 13}th.</p>
        </div>
        <input className="input" type="month" style={{ width: 'auto' }} value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value || thisMonth())} aria-label="Month" />
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Tile label="EXPECTED" value={kes(data.summary.expected)} />
            <Tile label="RECEIVED" value={kes(data.summary.received)} tone="ok" />
            <Tile label="OUTSTANDING" value={kes(data.summary.outstanding)} tone={data.summary.outstanding ? 'bad' : undefined} />
          </div>
          <SendMoneySettings initial={data.settings} onSaved={load} />
          {data.window.current && data.window.today < data.window.open && <p className="notice">This month's fees open on the {data.window.open}th. Rows show last month's commission so far.</p>}

          <section className="card stack" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <b>{monthLabel(data.period)} · commission from {monthLabel(data.commissionMonth)}</b>
              <input className="input" type="search" style={{ width: 'auto', minWidth: 220 }} placeholder="Search site, account or code" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Mentor</th><th>Commission {monthLabel(data.commissionMonth).split(' ')[0]}</th><th>This month so far</th><th>Agreement</th><th>Owes</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.operator_id} style={r.status === 'pending_review' ? { background: '#FFF8E1' } : undefined}>
                      <td>
                        <b>{r.site_name ?? 'No site yet'}</b>{(r.site_count ?? 0) > 1 && <span className="hint"> +{(r.site_count ?? 1) - 1} more</span>}
                        <div className="hint mono">{r.custom_domain ?? (r.subdomain ? `${r.subdomain}.mwasya.site` : r.accounts)}</div>
                        {r.operator_status === 'suspended' && <span className="badge" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}>Suspended</span>}
                      </td>
                      <td className="mono">{r.commission_prev === null ? <span className="hint" title="They haven't logged in with earnings access yet">Not reported</span> : <b style={{ color: 'var(--success)' }}>{usd(r.commission_prev)}</b>}</td>
                      <td className="mono hint">{usd(r.commission_this)}</td>
                      <td>
                        {editing === r.operator_id
                          ? <Agreement row={r} onDone={() => { setEditing(null); load(); }} />
                          : <button className="link-btn" onClick={() => setEditing(r.operator_id)}>
                              {r.fee_mode === 'fixed' ? kes(r.fee_kes) + '/mo' : r.fee_mode === 'percent' ? `${r.fee_pct}% of commission` : 'No fee'} ✎
                            </button>}
                      </td>
                      <td className="mono">{r.amount_kes === null ? '—' : <>{usd(r.amount_usd)}<div className="hint">{kes(r.amount_kes)}</div></>}</td>
                      <td>
                        {r.status ? <span className={`badge ${r.status === 'paid' ? 'badge-green' : r.status === 'pending_review' ? 'badge-blue' : ''}`}
                          style={r.status === 'due' ? { background: late ? 'var(--danger-tint)' : '#FFF4DB', color: late ? 'var(--danger)' : '#8A5A00' } : undefined}>
                          {r.status === 'due' && late ? 'Overdue' : STATUS[r.status]}</span> : <span className="hint">{r.fee_mode === 'none' ? 'No fee' : 'Not due yet'}</span>}
                        {r.mpesa_code && <div className="mono hint">{r.mpesa_code}{r.paid_via === 'mpesa_stk' ? ' · auto' : ''}</div>}
                        {r.paid_at && <div className="hint">{new Date(r.paid_at).toLocaleDateString()}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {r.due_id && r.status === 'pending_review' && <>
                          <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={() => review(r.due_id!, 'approve')}>Approve</button>{' '}
                          <button className="btn btn-secondary" style={{ padding: '5px 10px' }} onClick={() => review(r.due_id!, 'reject')}>Reject</button>{' '}
                        </>}
                        {r.due_id && r.status === 'due' && <>
                          <button className="btn btn-secondary" style={{ padding: '5px 10px' }} onClick={() => review(r.due_id!, 'approve')} title="Mark as paid (e.g. paid in cash)">Mark paid</button>{' '}
                          <button className="btn btn-secondary" style={{ padding: '5px 10px' }} onClick={() => review(r.due_id!, 'waive')}>Waive</button>{' '}
                        </>}
                        {r.due_id && (r.status === 'paid' || r.status === 'waived') && <button className="btn btn-ghost" style={{ padding: '5px 10px' }} onClick={() => review(r.due_id!, 'reopen')}>Reopen</button>}
                        {!r.due_id && r.fee_mode !== 'none' && data.window.current && <button className="btn btn-secondary" style={{ padding: '5px 10px' }} onClick={() => issue(r)} title="Create this month's fee now, before the 10th">Issue fee now</button>}
                        {r.status === 'due' && late && <button className="btn btn-secondary" style={{ padding: '5px 10px', color: 'var(--danger)' }} onClick={() => suspend(r)}>{r.operator_status === 'suspended' ? 'Reactivate' : 'Suspend'}</button>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No mentors yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="hint">Commission comes from each mentor's own Deriv earnings report and updates when they log in. "Check code": compare the M-Pesa code with the SMS on your phone, then Approve.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <section className="card stack" style={{ gap: 6, padding: 20 }}>
      <span className="hint" style={{ fontWeight: 600 }}>{label}</span>
      <b className="mono" style={{ fontSize: 26, color: tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{value}</b>
    </section>
  );
}

function Agreement({ row, onDone }: { row: Row; onDone: () => void }) {
  const [mode, setMode] = useState(row.fee_mode);
  const [kesAmt, setKes] = useState(String(row.fee_kes || 1000));
  const [pct, setPct] = useState(String(row.fee_pct || 20));
  const [err, setErr] = useState('');
  const save = async () => {
    const r = await fetch('/api/dues/agreement', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ operatorId: row.operator_id, mode, fee_kes: Number(kesAmt), fee_pct: Number(pct) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.error ?? 'Could not save');
    onDone();
  };
  return (
    <div className="stack" style={{ gap: 6, minWidth: 210 }}>
      <select className="input" style={{ padding: '6px 8px' }} value={mode} onChange={(e) => setMode(e.target.value as Row['fee_mode'])}>
        <option value="fixed">Fixed per month</option><option value="percent">% of commission</option><option value="none">No fee</option>
      </select>
      {mode === 'fixed' && <input className="input mono" style={{ padding: '6px 8px' }} type="number" min={1000} max={30000} step={500} value={kesAmt} onChange={(e) => setKes(e.target.value)} aria-label="KES per month" />}
      {mode === 'percent' && <input className="input mono" style={{ padding: '6px 8px' }} type="number" min={1} max={100} value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent" />}
      {err && <span className="error">{err}</span>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-primary" style={{ padding: '5px 10px' }} onClick={save}>Save</button>
        <button className="btn btn-ghost" style={{ padding: '5px 10px' }} onClick={onDone}>Cancel</button>
      </div>
      <span className="hint">Applies from the next fee.</span>
    </div>
  );
}

function SendMoneySettings({ initial, onSaved }: { initial: Data['settings']; onSaved: () => void }) {
  const [phone, setPhone] = useState(initial.send_money_phone);
  const [name, setName] = useState(initial.send_money_name);
  const [rate, setRate] = useState(String(initial.kes_per_usd));
  const [msg, setMsg] = useState('');
  const save = async () => {
    const r = await fetch('/api/dues/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ send_money_phone: phone, send_money_name: name, kes_per_usd: Number(rate) }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Saved.' : j.error ?? 'Could not save.');
    if (r.ok) onSaved();
  };
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <b>Where mentors send money</b>
      {!initial.send_money_phone && <p className="error" style={{ margin: 0 }}>Add your M-Pesa number so mentors know where to pay.</p>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div className="field"><label className="label" htmlFor="sm-phone">Your M-Pesa number</label><input id="sm-phone" className="input mono" inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="sm-name">Name shown on M-Pesa</label><input id="sm-name" className="input" placeholder="e.g. DENNIS KYALO" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label className="label" htmlFor="sm-rate">KES per USD</label><input id="sm-rate" className="input mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save}>Save</button>
        {msg && <span className="hint" aria-live="polite">{msg}</span>}
      </div>
    </section>
  );
}
