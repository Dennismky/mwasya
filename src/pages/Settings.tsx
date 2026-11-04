import { useEffect, useState } from 'react';
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
    setMsg(r.ok ? t('common.saved') : (j.error && j.error !== 'server_error' ? j.error : 'Could not save.'));
  };

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 820 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('set.title')}</h1>
        <p className="muted">{t('set.sub')}</p>
      </div>

      <section className="card stack" style={{ gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Profile</h2>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="dname">Display name</label>
            <input id="dname" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name or business" />
          </div>
          <div className="field">
            <label className="label" htmlFor="contact">Contact (phone, Telegram or email)</label>
            <input id="contact" className="input" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Shown to the person who invited you" />
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
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
    setMsg('Saved. Invalid entries were cleared.');
  };
  return (
    <section className="card stack" style={{ gap: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Support contacts <span className="badge badge-blue">Owner</span></h2>
      <p className="hint">Shown as buttons on everyone's Support page.</p>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
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
    setMsg(r.ok ? 'Saved.' : 'Could not save.');
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
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
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
