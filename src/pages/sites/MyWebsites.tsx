import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { ReadyChecklist, type Readiness } from './ReadyChecklist';

export interface SiteSummary {
  id: string; name: string; subdomain: string; status: 'draft' | 'live' | 'paused'; accent: string;
  custom_domain: string | null; domain_status: string; url: string; logoUrl: string | null; needs: string[]; updated_at: string;
  ready: Readiness;
}

type Tab = 'all' | 'live' | 'setup';

/** `/sites` — every trading site this mentor has built. */
export default function MyWebsites() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [openReady, setOpenReady] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetch('/api/sites', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Could not load your sites.'))))
      .then((j) => setSites(j.sites ?? []))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (s: SiteSummary, action: 'publish' | 'unpublish' | 'delete') => {
    setMenu(null);
    if (action === 'delete' && !confirm(`Delete ${s.name}? Its clients will no longer reach it.${s.custom_domain ? ` ${s.custom_domain} will be disconnected.` : ''}`)) return;
    const r = await fetch(action === 'delete' ? `/api/sites/${s.id}` : `/api/sites/${s.id}/${action}`, { method: action === 'delete' ? 'DELETE' : 'POST', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 402) return setError('Activate your account in Billing to publish.');
    if (!r.ok && r.status !== 204) return setError(j.error ?? 'That did not work.');
    load();
  };

  const status = (s: SiteSummary) =>
    s.status === 'draft' ? { dot: 'dot-demo', label: 'Needs setup' }
      : s.status === 'paused' ? { dot: 'dot-demo', label: 'Paused' }
      : s.needs.includes('dns') ? { dot: 'dot-demo', label: 'DNS pending' }
      : { dot: 'dot-real', label: 'Live' };

  const shown = (sites ?? []).filter((s) => {
    if (tab === 'live' && !(s.status === 'live' && !s.needs.length)) return false;
    if (tab === 'setup' && s.status === 'live' && !s.needs.length) return false;
    const t = q.trim().toLowerCase();
    return !t || s.name.toLowerCase().includes(t) || s.subdomain.includes(t) || (s.custom_domain ?? '').includes(t);
  });

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>My websites</h1>
        <Link className="btn btn-primary" to="/sites/new">+ New site</Link>
      </div>

      <div className="tabs-line" role="tablist">
        {([['all', 'All'], ['live', 'Live'], ['setup', 'Needs setup']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <input className="input" type="search" placeholder="Search by name or domain" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search sites" />
      {error && <p className="error" role="alert">{error}</p>}

      {sites === null ? <p className="muted"><span className="spinner" />Loading…</p>
        : sites.length === 0 ? (
          <section className="card stack" style={{ gap: 12, alignItems: 'flex-start' }}>
            <b style={{ fontSize: 18 }}>Build your first trading site</b>
            <p className="muted">Name it, pick a design and your bots, connect a domain, and your clients can start trading in minutes.</p>
            <Link className="btn btn-primary" to="/sites/new">Start building</Link>
          </section>
        ) : (
          <ul className="site-list">
            {shown.map((s) => {
              const st = status(s);
              return (
                <li key={s.id} className="site-row">
                  <button className="site-main" onClick={() => navigate(`/sites/${s.id}`)}>
                    {s.logoUrl ? <img className="site-logo" src={s.logoUrl} alt="" /> : <span className="site-logo" style={{ background: s.accent }}>{s.name.slice(0, 2).toUpperCase()}</span>}
                    <span className="stack" style={{ gap: 2, minWidth: 0, textAlign: 'left' }}>
                      <b>{s.name}</b>
                      <span className="site-domain">{s.custom_domain ?? `${s.subdomain}.mwasya.site`}</span>
                      <span className="row" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}><span className={`dot ${st.dot}`} />{st.label}</span>
                    </span>
                  </button>
                  <button className={`ready-badge ${s.ready.done ? 'ok' : ''}`} aria-expanded={openReady === s.id} onClick={() => setOpenReady(openReady === s.id ? null : s.id)}>
                    {s.ready.done ? '✓ Ready' : `${s.ready.left} to fix`}
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button className="btn btn-ghost" aria-label={`Actions for ${s.name}`} aria-expanded={menu === s.id} onClick={() => setMenu(menu === s.id ? null : s.id)}>⋮</button>
                    {menu === s.id && (
                      <div className="tp-menu" role="menu">
                        <button role="menuitem" onClick={() => navigate(`/sites/${s.id}`)}><Icon.Gear /> Edit</button>
                        {s.status === 'live' && <a role="menuitem" className="menu-link" href={s.url} target="_blank" rel="noreferrer"><Icon.Globe /> Open site</a>}
                        {s.status !== 'live'
                          ? <button role="menuitem" onClick={() => act(s, 'publish')}><Icon.Arrow /> Publish</button>
                          : <button role="menuitem" onClick={() => act(s, 'unpublish')}><Icon.Lock /> Take offline</button>}
                        <button role="menuitem" style={{ color: 'var(--danger)' }} onClick={() => act(s, 'delete')}>Delete</button>
                      </div>
                    )}
                  </div>
                  {openReady === s.id && <div style={{ flexBasis: '100%' }}><ReadyChecklist siteId={s.id} ready={s.ready} compact /></div>}
                </li>
              );
            })}
            {shown.length === 0 && <li className="muted" style={{ padding: 16 }}>No sites match.</li>}
          </ul>
        )}
    </div>
  );
}
