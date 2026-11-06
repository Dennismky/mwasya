import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';

interface Due { id: string; period: string; amount_usd: number; amount_kes: number; status: 'due' | 'pending_review' | 'paid' | 'waived'; mpesa_code: string | null; note: string | null; basis: { mode?: string; pct?: number; commission_usd?: number | null } }
interface Mine { open: Due[]; window: { open: number; by: number; today: number; overdue: boolean }; pay: { paybillNumber: string; paybillAccount: string; sendMoneyPhone: string; sendMoneyName: string; stk: boolean } }

const monthName = (p: string) => new Date(`${p}T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Yellow bell for mentors with a monthly fee due (10th–13th). Disappears once the owner approves the payment. */
export default function DuesBell() {
  const auth = useAuth();
  const [data, setData] = useState<Mine | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(() => {
    fetch('/api/dues/mine', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => undefined);
  }, []);
  useEffect(() => { if (auth.operator && auth.me?.operator.role !== 'owner') load(); return () => clearTimeout(poll.current); }, [auth.operator, auth.me, load]);

  if (!data || data.open.length === 0) return null;
  const due = data.open[0];
  const total = data.open.reduce((s, d) => s + d.amount_kes, 0);
  const late = data.window.overdue || data.open.some((d) => d.period < data.open[0].period);

  const submitCode = async () => {
    setBusy(true); setMsg('');
    const r = await fetch(`/api/dues/${due.id}/code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? 'Could not submit. Try again.');
    setCode(''); load();
  };
  const payStk = async () => {
    setBusy(true); setMsg('');
    const r = await fetch(`/api/dues/${due.id}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ phone }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? 'Could not start the payment.');
    setMsg(j.message ?? 'Check your phone and enter your M-Pesa PIN.');
    const check = (n: number) => { poll.current = setTimeout(async () => {
      await fetch(`/api/billing/payment?id=${j.paymentId}`, { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null);
      load(); if (n < 40) check(n + 1);
    }, 4000); };
    check(0);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className={`bell ${late ? 'bell-late' : ''}`} aria-label={`Payment due: KES ${total.toLocaleString()}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" /></svg>
        <span className="bell-dot" />
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Monthly fee">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div className="stack" style={{ gap: 2 }}>
              <b style={{ fontSize: 16 }}>{due.status === 'pending_review' ? 'Waiting for approval' : late ? 'Payment overdue' : 'Payment due'}</b>
              <span className="hint">Monthly fee for {monthName(due.period)} · due {data.window.open}–{data.window.by} {new Date(`${due.period}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</span>
            </div>
            <button className="btn btn-ghost" style={{ padding: 4 }} aria-label="Close" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div className="bell-amount">
            <b className="mono">{usd(due.amount_usd)}</b>
            <span className="hint">≈ KES {due.amount_kes.toLocaleString()}{due.basis?.mode === 'percent' ? ` · ${due.basis.pct}% of last month's commission (${usd(Number(due.basis.commission_usd ?? 0))})` : ''}</span>
          </div>
          {data.open.length > 1 && <p className="error" style={{ margin: 0 }}>You also have {data.open.length - 1} earlier unpaid month(s). Total KES {total.toLocaleString()}.</p>}
          {due.note && due.status === 'due' && <p className="error" style={{ margin: 0 }}>{due.note}</p>}

          {due.status === 'pending_review' ? (
            <p className="hint">We received your M-Pesa payment{due.mpesa_code ? <> <b className="mono">{due.mpesa_code}</b></> : null}. This notice clears as soon as it is approved.</p>
          ) : (
            <>
              {data.pay.stk && (
                <div className="stack" style={{ gap: 8 }}>
                  <b>Pay now with M-Pesa</b>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input mono" style={{ flex: 1 }} inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Your Safaricom number" />
                    <button className="btn btn-primary" disabled={busy || !phone.trim()} onClick={payStk}>Pay KES {due.amount_kes.toLocaleString()}</button>
                  </div>
                  <span className="hint">You get an M-Pesa prompt on your phone. The payment is then approved.{data.pay.paybillNumber ? ' Or pay manually below.' : data.pay.sendMoneyPhone ? ' Or use Send Money below.' : ''}</span>
                </div>
              )}
              {data.pay.paybillNumber || data.pay.sendMoneyPhone ? (
                <div className="stack" style={{ gap: 8 }}>
                  <b>{data.pay.paybillNumber ? 'Pay by Paybill' : 'Pay with Send Money'}</b>
                  {/* EDIT HERE: the payment steps mentors see. */}
                  <ol className="bell-steps">
                    {data.pay.paybillNumber ? <>
                      <li>Open <b>M-Pesa</b>, then <b>Lipa na M-Pesa</b>, then <b>Pay Bill</b>.</li>
                      <li>Business number: <b className="mono">{data.pay.paybillNumber}</b></li>
                      <li>Account number: <b className="mono">{data.pay.paybillAccount}</b></li>
                    </> : <>
                      <li>Open <b>M-Pesa</b> and choose <b>Send Money</b>.</li>
                      <li>Enter <b className="mono">{data.pay.sendMoneyPhone}</b>{data.pay.sendMoneyName ? <> ({data.pay.sendMoneyName})</> : null}.</li>
                    </>}
                    <li>Amount: <b className="mono">KES {due.amount_kes.toLocaleString()}</b>. Enter your PIN and send.</li>
                    <li>Copy the code from the M-Pesa SMS (e.g. <span className="mono">SKA1B2C3D4</span>) and paste it here.</li>
                  </ol>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input mono" style={{ flex: 1, textTransform: 'uppercase' }} maxLength={12} placeholder="M-Pesa code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="M-Pesa confirmation code" />
                    <button className="btn btn-primary" disabled={busy || code.trim().length < 10} onClick={submitCode}>{busy ? 'Sending…' : 'Submit'}</button>
                  </div>
                </div>
              ) : !data.pay.stk && <p className="hint">Payment details will appear here shortly.</p>}
            </>
          )}
          {msg && <p className="hint" aria-live="polite" style={{ margin: 0 }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
