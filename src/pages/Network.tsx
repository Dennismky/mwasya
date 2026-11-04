import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';

interface Person {
  id: string; parent_id: string | null; depth: number; role: string; status: 'active' | 'suspended';
  paid_until: string | null; created_at: string; last_login_at: string | null;
  site_name: string | null; subdomain: string | null; site_status: string | null;
  parent_site: string | null; parent_subdomain: string | null; accounts: string | null;
  bots_published: number; direct_children: number;
  markup_30d: number | null; earnings_at: string | null; custom_domain: string | null;
}
interface Summary { people: number; sites: number; suspended: number; paying: number; markup_30d: number }
const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ago = (s: string) => { const h = Math.round((Date.now() - new Date(s).getTime()) / 36e5); return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };
interface Invite { code: string; max_uses: number; uses: number; revoked: boolean; expires_at: string; created_at: string }
interface Detail {
  person: Person & { phone: string | null; deriv_app_id: string | null; markup: string | null };
  accounts: { account_id: string; account_type: string; currency: string | null }[];
  bots: { id: string; name: string; risk: string; status: string; updated_at: string }[];
  payments: { id: string; amount: number; status: string; mpesa_receipt: string | null; phone: string; created_at: string }[];
  history: { action: string; meta: Record<string, unknown>; created_at: string }[];
  earnings: { markup_30d: number; volume_30d: number; contracts_30d: number; clients_30d: number; fetched_at: string } | null;
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const json = (r: Response) => r.json().catch(() => ({}));

export default function Network() {
  const auth = useAuth();
  const isOwner = auth.me?.operator.role === 'owner';
  const billing = auth.me?.billing;

  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'direct'>('all');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ people: Person[]; total: number; pageSize: number; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Debounced search: one request per pause in typing, not per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(q.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const reqId = useRef(0);
  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ page: String(page), scope });
      if (query) p.set('q', query);
      if (status) p.set('status', status);
      const r = await fetch(`/api/network?${p}`, { credentials: 'same-origin' });
      if (id !== reqId.current) return; // a newer request superseded this one
      if (r.status === 401) return auth.expire();
      if (!r.ok) throw new Error('Could not load your network.');
      setData(await r.json());
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [page, scope, query, status, auth]);

  useEffect(() => { if (auth.operator) void load(); }, [load, auth.operator]);

  if (!auth.operator) return <p className="muted">Log in again to see your network.</p>;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Network</h1>
        <p className="muted">{isOwner ? 'Everyone with a site on Mwasya. You are the source of the network.' : 'People who joined through your invite links, and everyone they brought in.'}</p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))' }}>
        <Stat label="PEOPLE" value={data?.summary.people} />
        <Stat label="SITES" value={data?.summary.sites} />
        <Stat label="NETWORK MARKUP · 30 DAYS" text={data ? usd(data.summary.markup_30d ?? 0) : undefined} />
        {(billing?.priceKes ?? 0) > 0 && <Stat label="PAID ACCESS" value={data?.summary.paying} />}
        <Stat label="SUSPENDED" value={data?.summary.suspended} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', alignItems: 'start' }}>
        <InviteLinks canInvite={!auth.suspended && (billing?.active ?? true)} />

      </div>

      <section className="card stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <input className="input" style={{ flex: '1 1 260px' }} type="search" placeholder="Search by site name, address or Deriv account…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          <select className="input" style={{ width: 'auto' }} value={scope} onChange={(e) => { setScope(e.target.value as 'all'); setPage(1); }} aria-label="Who to show">
            <option value="all">Everyone under me</option>
            <option value="direct">Only my direct invites</option>
          </select>
          <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => { setStatus(e.target.value as ''); setPage(1); }} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div style={{ overflowX: 'auto', opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }} aria-busy={loading}>
          <table className="table">
            <thead>
              <tr><th>Site</th><th>Deriv accounts</th><th>Invited by</th><th>Markup · 30d</th><th>Under them</th><th>Bots</th>{(billing?.priceKes ?? 0) > 0 && <th>Access until</th>}<th>Joined</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data?.people.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p.id)} style={{ cursor: 'pointer', background: selected === p.id ? 'var(--primary-tint)' : undefined }}>
                  <td>
                    <b>{p.site_name ?? <span className="muted">No site yet</span>}</b>
                    {p.subdomain && <div className="hint mono">{p.custom_domain ?? `${p.subdomain}.mwasya.site`}</div>}
                  </td>
                  <td className="mono hint">{p.accounts ?? '—'}</td>
                  <td className="hint">{p.depth === 1 ? (isOwner ? 'You' : 'You') : (p.parent_site ?? '—')}</td>
                  <td className="mono" title={p.earnings_at ? `Updated ${ago(p.earnings_at)}` : "Not connected yet"}>{p.markup_30d === null ? <span className="hint">—</span> : <b style={{ color: "var(--success)" }}>{usd(p.markup_30d)}</b>}{p.earnings_at && <div className="hint" style={{ fontSize: 11 }}>{ago(p.earnings_at)}</div>}</td>
                  <td className="mono">{p.direct_children}</td>
                  <td className="mono">{p.bots_published}</td>
                  {(billing?.priceKes ?? 0) > 0 && <td className="hint">{p.paid_until && new Date(p.paid_until) > new Date() ? fmtDate(p.paid_until) : <span className="error">Expired</span>}</td>}
                  <td className="hint">{fmtDate(p.created_at)}</td>
                  <td><span className={`badge ${p.status === 'active' ? 'badge-green' : ''}`} style={p.status === 'suspended' ? { background: 'var(--danger-tint)', color: 'var(--danger)' } : undefined}>{p.status}</span></td>
                </tr>
              ))}
              {data && data.people.length === 0 && (
                <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 28 }}>{query || status ? 'Nobody matches.' : 'Nobody yet. Share an invite link to grow your network.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span className="hint">{data ? `${data.total} ${data.total === 1 ? 'person' : 'people'}` : ''}</span>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn btn-secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="hint">Page {page} of {totalPages}</span>
            <button className="btn btn-secondary" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </section>

      {selected && <PersonPanel id={selected} isOwner={isOwner} onClose={() => setSelected(null)} onChanged={() => void load()} />}
    </div>
  );
}

function Stat({ label, value, text }: { label: string; value?: number; text?: string }) {
  return (
    <section className="card stack" style={{ gap: 6, padding: 20 }}>
      <span className="hint" style={{ fontWeight: 600 }}>{label}</span>
      <b className="mono" style={{ fontSize: 28, color: text ? 'var(--success)' : undefined }}>{text ?? value ?? '—'}</b>
    </section>
  );
}

function InviteLinks({ canInvite }: { canInvite: boolean }) {
  const [list, setList] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = () => fetch('/api/invites', { credentials: 'same-origin' }).then(json).then((j) => setList(j.invites ?? [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setBusy(true); setError('');
    const r = await fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' });
    const j = await json(r);
    setBusy(false);
    if (r.status === 402) return setError('Activate your account in Billing to invite people.');
    if (r.status === 409) return setError('You have 20 active links. Revoke one first.');
    if (r.status === 429) return setError('Too many links created. Try again later.');
    if (!r.ok) return setError('Could not create a link.');
    setList((l) => [j.invite, ...l]);
  };
  const revoke = async (code: string) => {
    if (!confirm('Revoke this link? People who already joined stay in your network.')) return;
    const r = await fetch(`/api/invites?code=${encodeURIComponent(code)}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) setList((l) => l.map((i) => (i.code === code ? { ...i, revoked: true } : i)));
  };
  const url = (code: string) => `${window.location.origin}/?invite=${code}`;
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(url(code)); setCopied(code); setTimeout(() => setCopied(''), 1500); } catch { /* clipboard blocked */ }
  };
  const live = list.filter((i) => !i.revoked && new Date(i.expires_at) > new Date() && i.uses < i.max_uses);

  return (
    <section className="card stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Invite links</h2>
        <button className="btn btn-primary" disabled={busy || !canInvite} onClick={create}>{busy ? 'Creating…' : '+ New link'}</button>
      </div>
      <p className="hint">Anyone who logs in through your link gets their own site, placed under you. Links work for 90 days or 100 sign-ups.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {live.length === 0 ? <p className="muted">No active links.</p> : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 8 }}>
          {live.map((i) => (
            <li key={i.code} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'nowrap' }}>
              <code className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>{url(i.code)}</code>
              <span className="hint" title="Sign-ups">{i.uses}/{i.max_uses}</span>
              <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => copy(i.code)}>{copied === i.code ? 'Copied' : 'Copy'}</button>
              <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => revoke(i.code)}>Revoke</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PricingSettings({ onSaved }: { onSaved: () => void }) {
  const auth = useAuth();
  const [price, setPrice] = useState(String(auth.me?.billing.priceKes ?? 0));
  const [days, setDays] = useState(String(auth.me?.billing.periodDays ?? 30));
  const [msg, setMsg] = useState('');
  const save = async () => {
    setMsg('');
    const r = await fetch('/api/me/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ price_kes: Number(price), period_days: Number(days) }),
    });
    if (!r.ok) return setMsg('Enter a whole price (KES) and 1–366 days.');
    setMsg('Saved.');
    onSaved();
  };
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Pricing <span className="badge badge-blue">Owner</span></h2>
      <p className="hint">What operators pay with M-Pesa for access (publishing their site and inviting people). Set 0 to keep Mwasya free.</p>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="label" htmlFor="price">Price (KES)</label>
          <input id="price" className="input mono" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="label" htmlFor="days">Access (days)</label>
          <input id="days" className="input mono" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {!auth.me?.billing.mpesa && Number(price) > 0 && <p className="error">M-Pesa isn't configured yet, so operators can't pay. Add the MPESA_* settings in Vercel first.</p>}
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save}>Save pricing</button>
        {msg && <span className="hint" aria-live="polite">{msg}</span>}
      </div>
    </section>
  );
}

function PersonPanel({ id, isOwner, onClose, onChanged }: { id: string; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    fetch(`/api/network/${id}`, { credentials: 'same-origin' })
      .then(async (r) => { if (!r.ok) throw new Error('Could not load this person.'); setD(await r.json()); })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => { setD(null); load(); }, [load]);

  const act = async (action: 'suspend' | 'activate' | 'grant_days', days?: number) => {
    if (action === 'suspend' && !confirm('Suspend this operator? Their site goes offline immediately and they can no longer make changes.')) return;
    setBusy(true);
    const r = await fetch(`/api/network/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action, days }),
    });
    setBusy(false);
    if (!r.ok) return setError('That action failed.');
    load(); onChanged();
  };

  const p = d?.person;
  return (
    <section className="card stack" style={{ gap: 16 }} aria-label="Person details">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{p?.site_name ?? 'Operator'}{p?.subdomain && <span className="hint mono" style={{ marginLeft: 10, fontWeight: 400 }}>{p.subdomain}.mwasya.site</span>}</h2>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!d ? <p className="muted"><span className="spinner" />Loading…</p> : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
            <Fact k="Markup · 30 days" v={d.earnings ? `${usd(Number(d.earnings.markup_30d))} · ${d.earnings.contracts_30d} trades · ${d.earnings.clients_30d} clients` : "Not connected yet"} />
            {d.earnings && <Fact k="Earnings updated" v={ago(d.earnings.fetched_at)} />}
            <Fact k="Status" v={p!.status} />
            <Fact k="Invited by" v={p!.parent_site ?? 'You'} />
            <Fact k="Joined" v={fmtDate(p!.created_at)} />
            <Fact k="Last login" v={fmtDate(p!.last_login_at)} />
            <Fact k="Access until" v={p!.paid_until ? fmtDate(p!.paid_until) : '—'} />
            {p!.phone && <Fact k="M-Pesa phone" v={p!.phone} />}
            {p!.deriv_app_id && <Fact k="Deriv app ID" v={p!.deriv_app_id} />}
            {p!.markup !== null && <Fact k="Markup" v={`${p!.markup}%`} />}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b>Deriv accounts</b>
            <span className="mono hint">{d.accounts.map((a) => `${a.account_id} (${a.account_type}${a.currency ? ' ' + a.currency : ''})`).join(' · ') || '—'}</span>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <b>Bots ({d.bots.length})</b>
            <span className="hint">{d.bots.map((b) => `${b.name} · ${b.status}`).join('  |  ') || 'None'}</span>
          </div>
          {isOwner && (
            <>
              <div className="stack" style={{ gap: 6 }}>
                <b>Payments</b>
                <span className="hint">{d.payments.map((x) => `${fmtDate(x.created_at)} · KES ${x.amount} · ${x.status}${x.mpesa_receipt ? ' · ' + x.mpesa_receipt : ''}`).join('  |  ') || 'None'}</span>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <b>History</b>
                <span className="hint">{d.history.map((h) => `${fmtDate(h.created_at)} · ${h.action}`).join('  |  ') || 'None'}</span>
              </div>
              <div className="row" style={{ gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                {p!.status === 'active'
                  ? <button className="btn btn-secondary" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => act('suspend')}>Suspend</button>
                  : <button className="btn btn-primary" disabled={busy} onClick={() => act('activate')}>Reactivate</button>}
                <button className="btn btn-secondary" disabled={busy} onClick={() => act('grant_days', 30)}>Grant 30 days access</button>
                {p!.subdomain && <a className="btn btn-secondary" href={`https://${p!.subdomain}.mwasya.site`} target="_blank" rel="noreferrer">Open site ↗</a>}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="stack" style={{ gap: 2 }}>
      <span className="hint" style={{ fontSize: 12, fontWeight: 600 }}>{k.toUpperCase()}</span>
      <span className="mono" style={{ fontSize: 14 }}>{v}</span>
    </div>
  );
}
