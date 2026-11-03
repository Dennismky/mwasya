import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';

interface Payment { id: string; amount: number; status: string; mpesa_receipt: string | null; created_at: string }
type Phase = { s: 'idle' } | { s: 'sending' } | { s: 'waiting'; id: string; message: string } | { s: 'paid'; receipt: string | null } | { s: 'failed'; message: string };

const fmt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function Billing() {
  const auth = useAuth();
  const me = auth.me;
  const [phone, setPhone] = useState('');
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [history, setHistory] = useState<Payment[]>([]);
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadHistory = () => fetch('/api/billing', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { payments: [] })).then((j) => setHistory(j.payments ?? [])).catch(() => undefined);
  useEffect(() => { void loadHistory(); return () => clearTimeout(poll.current); }, []);

  if (!me) return <p className="muted">Log in again to see billing.</p>;
  const b = me.billing;
  const isOwner = me.operator.role === 'owner';

  const check = (id: string, started: number) => {
    poll.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/billing/payment?id=${id}`, { credentials: 'same-origin' });
        const j = await r.json();
        if (j.status === 'paid') { setPhase({ s: 'paid', receipt: j.receipt }); void auth.reloadMe(); void loadHistory(); return; }
        if (j.status === 'failed' || j.status === 'cancelled') {
          setPhase({ s: 'failed', message: j.status === 'cancelled' ? 'You cancelled the M-Pesa prompt.' : (j.message || 'The payment did not go through.') });
          void loadHistory();
          return;
        }
      } catch { /* keep polling */ }
      if (Date.now() - started > 3 * 60_000) return setPhase({ s: 'failed', message: 'No confirmation from M-Pesa yet. If you paid, it will show here shortly.' });
      check(id, started);
    }, 4000);
  };

  const pay = async () => {
    setPhase({ s: 'sending' });
    const r = await fetch('/api/billing/stk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ phone }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 422) return setPhase({ s: 'failed', message: 'Enter a Safaricom number like 0712 345 678.' });
    if (r.status === 429) return setPhase({ s: 'failed', message: 'Too many attempts. Wait a few minutes and try again.' });
    if (r.status === 503) return setPhase({ s: 'failed', message: 'M-Pesa payments are not set up yet. Please try again later.' });
    if (!r.ok) return setPhase({ s: 'failed', message: 'Could not reach M-Pesa. Please try again.' });
    setPhase({ s: 'waiting', id: j.id, message: j.message });
    check(j.id, Date.now());
  };

  const activeUntil = me.operator.paidUntil && new Date(me.operator.paidUntil) > new Date() ? me.operator.paidUntil : null;

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 760 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Billing</h1>
        <p className="muted">Access lets you publish your site and invite people under you.</p>
      </div>

      <section className="card stack" style={{ gap: 12 }}>
        <span className="hint" style={{ fontWeight: 600 }}>YOUR ACCESS</span>
        {isOwner ? <b style={{ fontSize: 20 }}>Owner — always active</b>
          : !b.required ? <b style={{ fontSize: 20 }}>Free — no payment needed right now</b>
          : activeUntil ? <b style={{ fontSize: 20, color: 'var(--success)' }}>Active until {fmt(activeUntil)}</b>
          : <b style={{ fontSize: 20, color: 'var(--danger)' }}>Not active</b>}
        {b.required && <span className="hint">KES {b.priceKes.toLocaleString()} for {b.periodDays} days. Paying again adds {b.periodDays} days to your current access.</span>}
      </section>

      {b.required && !isOwner && (
        <section className="card stack" style={{ gap: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Pay with M-Pesa</h2>
          <div className="field">
            <label className="label" htmlFor="phone">Safaricom number</label>
            <input id="phone" className="input mono" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" value={phone}
              onChange={(e) => setPhone(e.target.value)} disabled={phase.s === 'sending' || phase.s === 'waiting'} />
            <span className="hint">You'll get a prompt on this phone. Enter your M-Pesa PIN to pay KES {b.priceKes.toLocaleString()}.</span>
          </div>
          <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} disabled={!phone.trim() || phase.s === 'sending' || phase.s === 'waiting' || !b.mpesa} onClick={pay}>
            {phase.s === 'sending' ? 'Sending prompt…' : `Pay KES ${b.priceKes.toLocaleString()}`}
          </button>
          {!b.mpesa && <p className="error">M-Pesa payments are not set up yet.</p>}
          <div aria-live="polite">
            {phase.s === 'waiting' && <p className="muted"><span className="spinner" />{phase.message || 'Check your phone and enter your M-Pesa PIN.'} Waiting for confirmation…</p>}
            {phase.s === 'paid' && <p style={{ color: 'var(--success)', fontWeight: 600 }}>Payment received{phase.receipt ? ` (${phase.receipt})` : ''}. Your access is active.</p>}
            {phase.s === 'failed' && <p className="error" role="alert">{phase.message}</p>}
          </div>
        </section>
      )}

      <section className="card stack" style={{ gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Payment history</h2>
        {history.length === 0 ? <p className="muted">No payments yet.</p> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th>M-Pesa receipt</th></tr></thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}><td>{fmt(p.created_at)}</td><td className="mono">KES {p.amount.toLocaleString()}</td><td>{p.status}</td><td className="mono">{p.mpesa_receipt ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
