import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '../components/motion';
import { AnnouncementText, isWhatsApp } from '../components/AnnouncementText';

interface Site { id: string; name: string; subdomain: string; status: string }
interface Item { id: string; title: string; body: string; created_at: string }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** `/announcements` — a mentor posts messages that appear under the bell on their trading site. */
// EDIT HERE: mentor's page for posting announcements (studio side).
export default function Announcements() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [wa, setWa] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sites', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { sites: [] })).then((j) => {
      const list = (j.sites ?? []) as Site[];
      setSites(list);
      setSiteId((s) => s || list.find((x) => x.status === 'live')?.id || list[0]?.id || '');
    }).catch(() => setSites([]));
  }, []);

  useEffect(() => {
    if (!siteId) return;
    setItems(null);
    fetch(`/api/sites/${siteId}/announcements`, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { announcements: [] }))
      .then((j) => setItems(j.announcements ?? [])).catch(() => setItems([]));
  }, [siteId]);

  const post = async () => {
    setError('');
    if (!title.trim() || !body.trim()) return setError('Write a title and a message.');
    const link = wa.trim();
    if (link && !isWhatsApp(link)) return setError('Paste a WhatsApp link that starts with https://chat.whatsapp.com/ or https://wa.me/');
    // The group link is saved with the message; client sites show it as a "Join WhatsApp group" button.
    const text = link && !body.includes(link) ? `${body.trim()}\n\n${link}` : body;
    if (text.length > 1000) return setError('Message and link must be 1000 characters or less.');
    setBusy(true);
    const r = await fetch(`/api/sites/${siteId}/announcements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ title, body: text }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? 'Could not post. Try again.');
    setItems((x) => [j.announcement, ...(x ?? [])]);
    setTitle(''); setBody(''); setWa('');
    toast('Announcement posted');
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this announcement? Clients will no longer see it.')) return;
    const r = await fetch(`/api/sites/${siteId}/announcements?aid=${id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) { setItems((x) => (x ?? []).filter((a) => a.id !== id)); toast('Deleted', 'info'); }
  };

  if (sites && sites.length === 0) return (
    <div className="stack" style={{ gap: 12 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>Announcements</h1>
      <section className="card"><p className="muted">Create a site first. <Link to="/sites/new">New site →</Link></p></section>
    </div>
  );

  const site = sites?.find((s) => s.id === siteId);
  return (
    <div className="stack an" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800 }}>Announcements</h1>
        <p className="muted">Post a message to your clients. It appears under the bell on your trading site.</p>
      </div>

      <section className="card stack an-compose" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="label" htmlFor="an-site">Site</label>
          <select id="an-site" className="input" style={{ width: 'auto', minWidth: 220 }} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.subdomain}.mwasya.site</option>)}
          </select>
        </div>
        <input className="input" maxLength={80} placeholder="Title, e.g. New free bot added" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <textarea className="input" rows={4} maxLength={1000} placeholder="Message, e.g. Try the Even/Odd bot on demo first. Markets are busy after 10 am." value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" />
        {/* EDIT HERE: optional WhatsApp group link added to the announcement (shown to clients as a green Join button). */}
        <input className="input" type="url" inputMode="url" maxLength={200} placeholder="WhatsApp group link (optional), e.g. https://chat.whatsapp.com/…" value={wa} onChange={(e) => setWa(e.target.value)} aria-label="WhatsApp group link" />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <span className="hint">{body.length}/1000</span>
          <button className="btn btn-primary" disabled={busy || !siteId} onClick={() => void post()}>{busy ? 'Posting…' : `Post to ${site?.name ?? 'site'}`}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <b>Posted</b>
        {items === null ? <div className="sk">{[1, 2].map((i) => <span key={i} style={{ height: 70 }} />)}</div>
          : items.length === 0 ? <p className="muted">Nothing posted yet.</p>
          : items.map((a) => (
            <article key={a.id} className="card an-item">
              <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                <b>{a.title}</b>
                <span className="hint">{ago(a.created_at)}</span>
              </div>
              <AnnouncementText text={a.body} />
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => void remove(a.id)}>Delete</button>
            </article>
          ))}
      </section>
    </div>
  );
}
