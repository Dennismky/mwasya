import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';

interface Result { domain: string; available: boolean; buyable: boolean; premium?: boolean; kes: number | null; renewKes: number | null }
type Phase =
  | { s: 'search' }
  | { s: 'details'; pick: Result }
  | { s: 'paying'; orderId: string; paymentId: string | null; domain: string; message?: string }
  | { s: 'done'; domain: string }
  | { s: 'failed'; message: string };

const STEPS = ['Payment', 'Registering', 'Connecting', 'Live'];
const stepOf = (status: string, paid: boolean) =>
  status === 'completed' ? 3 : status === 'purchasing' ? 1 : status === 'paid' ? 1 : paid ? 1 : 0;

/** Mentor buys a brand-new domain; we register it on Vercel and connect it to their trading site. */
export default function BuyDomain({ onConnected }: { onConnected: (domain: string) => void }) {
  const auth = useAuth();
  const isOwner = auth.me?.operator.role === 'owner';
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>({ s: 'search' });
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', address1: '', city: 'Nairobi', state: 'Nairobi', zip: '00100', country: 'KE', companyName: '' });
  const [orderStatus, setOrderStatus] = useState('awaiting_payment');
  const [paid, setPaid] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const search = async () => {
    setBusy(true); setError(''); setResults(null);
    const r = await fetch(`/api/domains/search?q=${encodeURIComponent(q)}`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(typeof j.error === 'string' && j.error !== 'server_error' ? j.error : 'Search failed. Try again.');
    setResults(j.results ?? []);
  };

  const poll = (orderId: string, paymentId: string | null, domain: string, started: number) => {
    timer.current = setTimeout(async () => {
      try {
        if (paymentId && !paid) {
          const p = await fetch(`/api/billing/payment?id=${paymentId}`, { credentials: 'same-origin' }).then((r) => r.json());
          if (p.status === 'paid') setPaid(true);
          if (p.status === 'failed' || p.status === 'cancelled') {
            return setPhase({ s: 'failed', message: p.status === 'cancelled' ? 'You cancelled the M-Pesa prompt. Nothing was charged.' : 'The M-Pesa payment did not go through. Nothing was charged.' });
          }
        }
        const o = await fetch(`/api/domains/order?id=${orderId}`, { credentials: 'same-origin' }).then((r) => r.json());
        const st = o.order?.status as string | undefined;
        if (st) setOrderStatus(st);
        if (st === 'completed') { setPhase({ s: 'done', domain }); onConnected(domain); return; }
        if (st === 'needs_review') return setPhase({ s: 'failed', message: 'Your payment was received. The domain needs a quick check by the platform team, and it will be connected for you shortly.' });
        if (st === 'cancelled') return setPhase({ s: 'failed', message: 'The order was cancelled. Nothing was charged.' });
      } catch { /* keep polling */ }
      if (Date.now() - started > 10 * 60_000) return setPhase({ s: 'failed', message: 'This is taking longer than usual. Your order is saved; check back in a few minutes.' });
      poll(orderId, paymentId, domain, started);
    }, 4000);
  };

  const order = async (pick: Result) => {
    setBusy(true); setError('');
    const r = await fetch('/api/domains/order', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ domain: pick.domain, contact: form, phone: form.phone }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.status === 402) return setError('Activate your account in Billing first.');
    if (!r.ok) return setError(typeof j.error === 'string' && j.error !== 'server_error' ? j.error : 'Could not start the order. Try again.');
    setPaid(!j.paymentId);
    setOrderStatus(j.paymentId ? 'awaiting_payment' : 'paid');
    setPhase({ s: 'paying', orderId: j.orderId, paymentId: j.paymentId, domain: pick.domain, message: j.message });
    poll(j.orderId, j.paymentId, pick.domain, Date.now());
  };

  const field = (k: keyof typeof form, label: string, props: Record<string, unknown> = {}) => (
    <div className="field">
      <label className="label" htmlFor={`bd-${k}`}>{label}</label>
      <input id={`bd-${k}`} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} />
    </div>
  );

  if (phase.s === 'paying') {
    const at = stepOf(orderStatus, paid);
    return (
      <div className="stack" style={{ gap: 14 }} aria-live="polite">
        <b>Buying <span className="mono">{phase.domain}</span></b>
        <ol className="buy-steps">
          {STEPS.map((label, i) => <li key={label} className={i < at ? 'done' : i === at ? 'now' : ''}>{i < at ? '✓' : i === at ? <span className="spinner" /> : i + 1} {label}</li>)}
        </ol>
        {at === 0 && <p className="hint">{phase.message ?? 'Check your phone and enter your M-Pesa PIN.'}</p>}
        {at >= 1 && <p className="hint">Registering your domain. This usually takes under a minute.</p>}
      </div>
    );
  }
  if (phase.s === 'done') return <p style={{ color: 'var(--success)', fontWeight: 600 }}>{phase.domain} is yours and connected to your trading site. HTTPS is set up automatically.</p>;
  if (phase.s === 'failed') return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="error" role="alert">{phase.message}</p>
      <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => { setPhase({ s: 'search' }); setResults(null); }}>Back to search</button>
    </div>
  );

  if (phase.s === 'details') {
    const p = phase.pick;
    return (
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <b>Registrant details for <span className="mono">{p.domain}</span></b>
          <button className="btn btn-ghost" onClick={() => setPhase({ s: 'search' })}>Change domain</button>
        </div>
        <p className="hint">Domain registries require the owner's name and address. This is you, the domain's owner.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {field('firstName', 'First name', { autoComplete: 'given-name' })}
          {field('lastName', 'Last name', { autoComplete: 'family-name' })}
          {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
          {field('phone', isOwner ? 'Phone (+2547…)' : 'M-Pesa number (pays and is the contact)', { inputMode: 'tel', autoComplete: 'tel', placeholder: '0712 345 678' })}
          {field('address1', 'Street address', { autoComplete: 'address-line1' })}
          {field('city', 'City', { autoComplete: 'address-level2' })}
          {field('state', 'County / State', { autoComplete: 'address-level1' })}
          {field('zip', 'Postal code', { autoComplete: 'postal-code' })}
          {field('country', 'Country code', { maxLength: 2, placeholder: 'KE' })}
          {field('companyName', 'Company (optional)', { autoComplete: 'organization' })}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => order(p)}>
          {busy ? 'Starting…' : isOwner ? `Buy ${p.domain}` : `Pay KES ${p.kes?.toLocaleString()} with M-Pesa`}
        </button>
        <span className="hint">1 year. {p.renewKes ? `Renews at about KES ${p.renewKes.toLocaleString()} per year; we'll remind you before it expires.` : ''}</span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input mono" style={{ flex: '1 1 240px' }} placeholder="Search a name, e.g. statefx" value={q}
          onChange={(e) => setQ(e.target.value.trim().toLowerCase())} onKeyDown={(e) => { if (e.key === 'Enter' && q.length >= 2) void search(); }} aria-label="Domain name" />
        <button className="btn btn-primary" disabled={busy || q.length < 2} onClick={search}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {results && (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
          {results.length === 0 && <li className="muted">No results.</li>}
          {results.map((r) => (
            <li key={r.domain} className="domain-row">
              <span className="mono" style={{ fontWeight: 700 }}>{r.domain}</span>
              {r.buyable ? (
                <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <b className="mono">KES {r.kes?.toLocaleString()}<span className="hint"> /yr</span></b>
                  <button className="btn btn-primary" style={{ padding: '6px 14px' }} onClick={() => setPhase({ s: 'details', pick: r })}>Buy</button>
                </span>
              ) : <span className="hint">{r.available ? (r.premium ? 'Premium, not offered' : 'Not offered') : 'Taken'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
