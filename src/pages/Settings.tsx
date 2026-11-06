import { useEffect, useState, type CSSProperties, type DragEvent } from 'react';
import { youtubeId } from '../shared/youtube';
import { toast } from '../components/motion';
import { useAuth } from '../lib/auth';
import { LANGUAGES, useLang, useT, type Lang } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import { PricingSettings } from './Network';

export default function Settings() {
  const t = useT();
  const auth = useAuth();
  const isOwner = auth.me?.operator.role === 'owner';
  const { lang, setLang } = useLang();
  const { theme, toggle } = useTheme();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/settings/profile', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j?.profile) return;
      setName(j.profile.display_name ?? '');
      setContact(j.profile.contact ?? '');
    }).catch(() => undefined);
  }, []);

  const save = async () => {
    setMsg('');
    const r = await fetch('/api/settings/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ display_name: name, contact, language: lang }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) toast(t('common.saved'));
    setMsg(r.ok ? '' : (j.error && j.error !== 'server_error' ? j.error : 'Could not save.'));
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('set.title')}</h1>
        <p className="muted">{t('set.sub')}</p>
      </div>

      <SiteColours />
      <TutorialVideos />

      <section className="card stack" style={{ gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Profile</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="dname">Display name</label>
            <input id="dname" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or business" />
          </div>
          <div className="field">
            <label className="label" htmlFor="contact">Contact (phone, Telegram or email)</label>
            <input id="contact" className="input" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Shown to the person who invited you" />
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="lang">{t('nav.language')}</label>
            <select id="lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label">Theme</span>
            <div className="row" style={{ gap: 8 }}>
              <button className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => theme !== 'light' && toggle()}>Light</button>
              <button className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => theme !== 'dark' && toggle()}>Dark</button>
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save}>{t('common.save')}</button>
          {msg && <span className="hint" aria-live="polite">{msg}</span>}
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Deriv accounts</h2>
        <p className="hint">Linked through your Deriv login (trade access only).</p>
        <span className="mono">{auth.accounts.map((a) => a.label).join(' · ') || '—'}</span>
      </section>

      {isOwner && (
        <>
          <PricingSettings onSaved={() => void auth.reloadMe()} />
          <SupportContacts />
          <DomainSales />
        </>
      )}
    </div>
  );
}

function SupportContacts() {
  const [c, setC] = useState({ whatsapp: '', telegram: '', email: '' });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    fetch('/api/support/contacts', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setC({ whatsapp: '', telegram: '', email: '', ...(j.contacts ?? {}) })).catch(() => undefined);
  }, []);
  const save = async () => {
    const r = await fetch('/api/support/contacts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(c) });
    if (!r.ok) return setMsg('Could not save.');
    const j = await r.json();
    setC({ whatsapp: '', telegram: '', email: '', ...j.contacts });
    toast('Saved. Invalid entries were cleared.');
  };
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Support contacts <span className="badge badge-blue">Owner</span></h2>
      <p className="hint">Shown as buttons on everyone's Support page.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
        <div className="field"><label className="label" htmlFor="wa">WhatsApp number</label><input id="wa" className="input mono" placeholder="2547XXXXXXXX" value={c.whatsapp} onChange={(e) => setC({ ...c, whatsapp: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="tg">Telegram username</label><input id="tg" className="input mono" placeholder="@mwasya" value={c.telegram} onChange={(e) => setC({ ...c, telegram: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="em">Email</label><input id="em" className="input mono" placeholder="support@mwasya.site" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save}>Save contacts</button>
        {msg && <span className="hint" aria-live="polite">{msg}</span>}
      </div>
    </section>
  );
}

interface DomainOrder { id: string; domain: string; status: string; kes_amount: number; usd_price: number; error: string | null; created_at: string; site_name: string | null }

/** Owner: domain sales settings + every order (retry the ones that need review). */
function DomainSales() {
  const [cfg, setCfg] = useState({ enabled: false, kes_per_usd: 130, margin_pct: 20, max_usd: 60 });
  const [configured, setConfigured] = useState(true);
  const [orders, setOrders] = useState<DomainOrder[]>([]);
  const [msg, setMsg] = useState('');
  const load = () => {
    fetch('/api/domains/settings', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { if (j.settings) setCfg(j.settings); setConfigured(j.configured !== false); }).catch(() => undefined);
    fetch('/api/domains', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setOrders(j.orders ?? [])).catch(() => undefined);
  };
  useEffect(load, []);
  const save = async () => {
    const r = await fetch('/api/domains/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(cfg) });
    if (r.ok) toast('Saved'); setMsg(r.ok ? '' : 'Could not save.');
  };
  const retry = async (id: string) => {
    if (!confirm('Buy this domain now at today\'s Vercel price? This charges your Vercel account.')) return;
    const r = await fetch('/api/domains/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ id }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Order is now: ${j.order?.status}` : (j.error ?? 'Retry failed'));
    load();
  };
  const example = Math.ceil((11 * cfg.kes_per_usd * (1 + cfg.margin_pct / 100)) / 10) * 10;
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Domain sales <span className="badge badge-blue">Owner</span></h2>
      <p className="hint">Mentors buy domains on Sites and pay you with M-Pesa; we then register the domain on your Vercel account and connect it automatically.</p>
      {!configured && <p className="error">Add VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID in Vercel first.</p>}
      <label className="row" style={{ gap: 10, alignItems: 'center' }}>
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> <b>Let mentors buy domains</b>
      </label>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 12 }}>
        <div className="field"><label className="label" htmlFor="ds-rate">KES per USD</label><input id="ds-rate" className="input mono" inputMode="decimal" value={cfg.kes_per_usd} onChange={(e) => setCfg({ ...cfg, kes_per_usd: Number(e.target.value.replace(/[^\d.]/g, '')) })} /></div>
        <div className="field"><label className="label" htmlFor="ds-margin">Your margin (%)</label><input id="ds-margin" className="input mono" inputMode="decimal" value={cfg.margin_pct} onChange={(e) => setCfg({ ...cfg, margin_pct: Number(e.target.value.replace(/[^\d.]/g, '')) })} /></div>
        <div className="field"><label className="label" htmlFor="ds-max">Max Vercel price (USD)</label><input id="ds-max" className="input mono" inputMode="decimal" value={cfg.max_usd} onChange={(e) => setCfg({ ...cfg, max_usd: Number(e.target.value.replace(/[^\d.]/g, '')) })} /></div>
      </div>
      <span className="hint">Example: an $11 .com sells for about KES {example.toLocaleString()}.</span>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={save}>Save</button>
        {msg && <span className="hint" aria-live="polite">{msg}</span>}
      </div>
      {orders.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Domain</th><th>Site</th><th>Paid</th><th>Status</th><th /></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.domain}</td>
                  <td>{o.site_name ?? '—'}</td>
                  <td className="mono">{o.kes_amount ? `KES ${o.kes_amount.toLocaleString()}` : 'Owner'}</td>
                  <td><span className={`badge ${o.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>{o.status.replace('_', ' ')}</span>{o.error && <div className="hint">{o.error}</div>}</td>
                  <td>{o.status === 'needs_review' && <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => retry(o.id)}>Retry</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface VideoRow { id: string; title: string; youtube_id: string }

/**
 * Tutorial videos: a mentor adds YouTube videos to their client site's Tutorials tab.
 * Paste a link, or drag a YouTube link or address-bar icon onto the box.
 */
function TutorialVideos() {
  const [sites, setSites] = useState<SiteLite[] | null>(null);
  const [id, setId] = useState('');
  const [videos, setVideos] = useState<VideoRow[] | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sites', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { sites: [] })).then((j) => {
      const list = (j.sites ?? []) as SiteLite[];
      setSites(list);
      if (list[0]) setId(list[0].id);
    }).catch(() => setSites([]));
  }, []);
  useEffect(() => {
    if (!id) return;
    setVideos(null); setError('');
    fetch(`/api/sites/${id}/videos`, { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('Could not load your videos.'); return r.json(); })
      .then((j) => setVideos(j.videos ?? []))
      .catch((e: Error) => { setVideos([]); setError(e.message); });
  }, [id]);

  const preview = youtubeId(url);
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false); setError('');
    const link = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split(/\r?\n/).find((l) => l && !l.startsWith('#')) ?? '';
    if (youtubeId(link)) setUrl(link.trim());
    else setError(e.dataTransfer.files.length ? 'Video files are not uploaded here. Put the video on YouTube, then drag or paste its link.' : 'That is not a YouTube video link.');
  };
  const add = async () => {
    if (!title.trim()) return setError('Give the video a title.');
    if (!preview) return setError('Paste a YouTube video link.');
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/sites/${id}/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ title, url }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Could not add the video. Try again.');
      setVideos((v) => [j.video, ...(v ?? [])]);
      setUrl(''); setTitle('');
      toast('Video added to Tutorials');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async (v: VideoRow) => {
    if (!confirm(`Remove "${v.title}" from Tutorials?`)) return;
    const r = await fetch(`/api/sites/${id}/videos?vid=${v.id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) { setVideos((l) => (l ?? []).filter((x) => x.id !== v.id)); toast('Video removed', 'info'); } else setError('Could not remove the video.');
  };

  if (sites && sites.length === 0) return null; // no website yet
  return (
    <section className="card stack" style={{ gap: 14 }} aria-label="Tutorial videos">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="stack" style={{ gap: 2 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Tutorial videos</h2>
          <span className="hint">Videos appear at the top of Tutorials on your client site. Upload to YouTube first (Unlisted works).</span>
        </div>
        {sites && sites.length > 1 && (
          <select className="input" style={{ width: 'auto' }} value={id} onChange={(e) => setId(e.target.value)} aria-label="Website">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className={`tv-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        {preview
          ? <img src={`https://i.ytimg.com/vi/${preview}/mqdefault.jpg`} alt="" />
          : <span className="tv-drop-ico" aria-hidden="true">▶</span>}
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
          <input className="input" type="url" inputMode="url" maxLength={300} placeholder="Drag or paste a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="YouTube link" />
          <input className="input" maxLength={80} placeholder="Title, e.g. How to use Over 3" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Video title" />
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !id || !preview || !title.trim()} onClick={() => void add()}>{busy ? 'Adding…' : 'Add to Tutorials'}</button>
      {videos === null ? <p className="hint">Loading videos…</p> : videos.length > 0 && (
        <ul className="tv-list">
          {videos.map((v) => (
            <li key={v.id}>
              <img src={`https://i.ytimg.com/vi/${v.youtube_id}/default.jpg`} alt="" loading="lazy" />
              <b title={v.title}>{v.title}</b>
              <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => void remove(v)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// EDIT HERE: ready-made colours a mentor can pick for their client website (any other colour via "Custom").
const SITE_COLOURS = ['#1F4FD1', '#0B1F3A', '#0E7C66', '#3B3FB6', '#0F6E9E', '#2D3748', '#E11D48', '#C9A227', '#7C3AED', '#EA580C'];
interface SiteLite { id: string; name: string; subdomain: string; accent: string; theme: 'light' | 'dark' }

/** Website colours: a mentor changes their client site's main colour and light/dark look; clients see it on their next visit. */
function SiteColours() {
  const [sites, setSites] = useState<SiteLite[] | null>(null);
  const [id, setId] = useState('');
  const [accent, setAccent] = useState('#1F4FD1');
  const [look, setLook] = useState<'light' | 'dark'>('light');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sites', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { sites: [] })).then((j) => {
      const list = (j.sites ?? []) as SiteLite[];
      setSites(list);
      if (list[0]) { setId(list[0].id); setAccent(list[0].accent.toUpperCase()); setLook(list[0].theme === 'dark' ? 'dark' : 'light'); }
    }).catch(() => setSites([]));
  }, []);
  const site = sites?.find((s) => s.id === id);
  const pickSite = (sid: string) => { const s = sites?.find((x) => x.id === sid); setId(sid); if (s) { setAccent(s.accent.toUpperCase()); setLook(s.theme === 'dark' ? 'dark' : 'light'); } };
  const changed = !!site && (site.accent.toUpperCase() !== accent.toUpperCase() || site.theme !== look);

  const save = async () => {
    if (!site) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/sites/${site.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ accent, theme: look }) });
      if (!r.ok) throw new Error('Could not save the colours. Try again.');
      setSites((l) => l?.map((s) => (s.id === site.id ? { ...s, accent, theme: look } : s)) ?? null);
      toast(`${site.name} colours saved`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (sites && sites.length === 0) return null; // no website yet: colours are chosen when it is created
  const dark = look === 'dark';
  return (
    <section className="card stack" style={{ gap: 16 }} aria-label="Website colours">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Website colours</h2>
        {sites && sites.length > 1 && (
          <select className="input" style={{ width: 'auto' }} value={id} onChange={(e) => pickSite(e.target.value)} aria-label="Website">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>
      {!sites ? <p className="hint">Loading your website…</p> : (
        <div className="sc-colours">
          <div className="stack" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label">Main colour</span>
              <div className="sc-swatches">
                {SITE_COLOURS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={accent === c} className={accent === c ? 'on' : ''} style={{ background: c }} onClick={() => setAccent(c)} />)}
                <label className="sc-custom" title="Any colour">Custom <input type="color" value={accent} onChange={(e) => setAccent(e.target.value.toUpperCase())} /></label>
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="label">Look clients see first</span>
              <div className="seg" style={{ maxWidth: 260 }}>
                <button type="button" className={!dark ? 'on' : ''} onClick={() => setLook('light')}>☀ Light</button>
                <button type="button" className={dark ? 'on' : ''} onClick={() => setLook('dark')}>☾ Dark</button>
              </div>
              <span className="hint">Clients can still switch light / dark on the site.</span>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" disabled={!changed || busy} onClick={save}>{busy ? 'Saving…' : 'Save colours'}</button>
              {changed && <button className="btn btn-ghost" onClick={() => site && pickSite(site.id)}>Undo</button>}
            </div>
          </div>
          {/* Live preview of the client site's top bar, tab, cards and Run button. */}
          <div className={`sc-preview ${dark ? 'dark' : ''}`} style={{ '--sc': accent } as CSSProperties} aria-label="Preview">
            <div className="sc-p-head"><span className="sc-p-mark">{(site?.name ?? 'S').charAt(0).toUpperCase()}</span><b>{site?.name}</b><span className="sc-p-btn">Cashier</span></div>
            <div className="sc-p-nav"><span className="on">Dashboard</span><span>Bot Builder</span><span>Quick Bot</span></div>
            <div className="sc-p-body"><span className="sc-p-card" /><span className="sc-p-card" /><span className="sc-p-run">▶ Run</span></div>
            <small className="mono">{site?.subdomain}.mwasya.site</small>
          </div>
        </div>
      )}
    </section>
  );
}
