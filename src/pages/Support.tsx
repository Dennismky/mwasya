import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useT } from '../lib/i18n';

interface Ticket { id: string; subject: string; status: 'open' | 'answered' | 'closed'; updated_at: string; site_name: string | null; subdomain: string | null; accounts: string | null }
interface Message { id: number; from_owner: boolean; body: string; created_at: string }
interface Contacts { whatsapp?: string; telegram?: string; email?: string }

const when = (s: string) => new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATUS_STYLE = { open: 'badge-blue', answered: 'badge-green', closed: '' } as const;

export default function Support() {
  const t = useT();
  const auth = useAuth();
  const isOwner = auth.me?.operator.role === 'owner';
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<'' | 'open' | 'answered' | 'closed'>('');
  const [open, setOpen] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contacts>({});
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/support${filter ? `?status=${filter}` : ''}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { tickets: [] })).then((j) => setTickets(j.tickets ?? [])).catch(() => undefined);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/support/contacts', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : {})).then((j: { contacts?: Contacts }) => setContacts(j.contacts ?? {})).catch(() => undefined);
  }, []);

  const create = async () => {
    setSending(true); setError('');
    const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ subject, body }) });
    const j = await r.json().catch(() => ({}));
    setSending(false);
    if (!r.ok) return setError(j.error && j.error !== 'server_error' ? j.error : 'Could not send. Try again.');
    setSubject(''); setBody(''); setOpen(j.id); load();
  };

  const wa = contacts.whatsapp?.replace(/\D/g, '');
  const tg = contacts.telegram?.replace(/^@/, '');

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('sup.title')}</h1>
        <p className="muted">{isOwner ? 'Tickets from everyone on the platform. Reply here and they see it on their Support page.' : t('sup.sub')}</p>
      </div>

      {(wa || tg || contacts.email) && (
        <div className="row" style={{ gap: 10 }}>
          {wa && <a className="btn btn-secondary" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          {tg && <a className="btn btn-secondary" href={`https://t.me/${tg}`} target="_blank" rel="noreferrer">Telegram</a>}
          {contacts.email && <a className="btn btn-secondary" href={`mailto:${contacts.email}`}>Email</a>}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', alignItems: 'start' }}>
        {!isOwner && (
          <section className="card stack" style={{ gap: 14 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>New ticket</h2>
            <div className="field">
              <label className="label" htmlFor="subj">Subject</label>
              <input id="subj" className="input" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. My site won't load" />
            </div>
            <div className="field">
              <label className="label" htmlFor="msg">Message</label>
              <textarea id="msg" className="input" rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, and what did you expect?" />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={sending || subject.trim().length < 3 || !body.trim()} onClick={create}>{sending ? 'Sending…' : 'Send'}</button>
          </section>
        )}

        <section className="card stack" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{isOwner ? 'All tickets' : 'Your tickets'}</h2>
            <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={filter} onChange={(e) => setFilter(e.target.value as '')} aria-label="Filter">
              <option value="">All</option><option value="open">Open</option><option value="answered">Answered</option><option value="closed">Closed</option>
            </select>
          </div>
          {tickets.length === 0 ? <p className="muted">No tickets.</p> : (
            <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 6 }}>
              {tickets.map((tk) => (
                <li key={tk.id}>
                  <button className="ticket-row" aria-expanded={open === tk.id} onClick={() => setOpen(open === tk.id ? null : tk.id)}>
                    <span className="stack" style={{ gap: 2, textAlign: 'left', minWidth: 0 }}>
                      <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.subject}</b>
                      <span className="hint">{isOwner ? `${tk.site_name ?? tk.accounts ?? 'Operator'} · ` : ''}{when(tk.updated_at)}</span>
                    </span>
                    <span className={`badge ${STATUS_STYLE[tk.status]}`}>{tk.status}</span>
                  </button>
                  {open === tk.id && <Thread id={tk.id} isOwner={isOwner} onChanged={load} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Thread({ id, isOwner, onChanged }: { id: string; isOwner: boolean; onChanged: () => void }) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [status, setStatus] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/support/${id}`, { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { setMsgs(j.messages ?? []); setStatus(j.ticket?.status ?? ''); }).catch(() => undefined);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const r = await fetch(`/api/support/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payload) });
    setBusy(false);
    if (r.ok) { setReply(''); load(); onChanged(); }
  };

  return (
    <div className="thread">
      {msgs.map((m) => (
        <div key={m.id} className={`bubble ${m.from_owner ? 'bubble-owner' : ''}`}>
          <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>{m.from_owner ? 'MWASYA SUPPORT' : isOwner ? 'OPERATOR' : 'YOU'} · {when(m.created_at)}</span>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</p>
        </div>
      ))}
      {status !== 'closed' ? (
        <>
          <textarea className="input" rows={3} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" aria-label="Reply" />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={() => send({ body: reply })}>Reply</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => send({ status: 'closed' })}>Close ticket</button>
          </div>
        </>
      ) : (
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => send({ status: 'open' })}>Reopen</button>
      )}
    </div>
  );
}
