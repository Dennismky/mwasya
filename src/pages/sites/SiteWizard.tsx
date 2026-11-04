import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { DEFAULT_FEATURES, SITE_FEATURES, SITE_TEMPLATES, templateOf } from '../../shared/templates';
import DomainStep from './DomainStep';
import { ReadyChecklist, type Readiness } from './ReadyChecklist';

interface Site {
  id: string; name: string; subdomain: string; tagline: string | null; accent: string; theme: 'light' | 'dark'; template: string;
  features: string[]; free_bots: string[]; deriv_app_id: string | null; markup: number; status: string;
  custom_domain: string | null; domain_status: string; logoUrl: string | null; url: string; subdomainUrl: string;
  ready?: Readiness;
}
interface CatalogBot { id: string; name: string; description: string; catalog: boolean; mine: boolean }

const STEPS = ['name', 'address', 'features', 'logo', 'design', 'colours', 'bots', 'deriv', 'domain', 'review'] as const;
type Step = (typeof STEPS)[number];
const SUGGEST = ['Apex Desk', 'Night Pips', 'Signal Harbor', 'Forge Markets', 'Volt Traders', 'Pip Republic'];
// Mwasya's palette first; mentors can still pick any custom colour for their own site.
const ACCENTS = ['#1F4FD1', '#0B1F3A', '#0E7C66', '#3B3FB6', '#0F6E9E', '#2D3748', '#E11D48', '#C9A227'];

/** `/sites/new` and `/sites/:id` — full-screen, one question per screen; every step saves. */
export default function SiteWizard() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [site, setSite] = useState<Site | null>(null);
  const [draft, setDraft] = useState<Partial<Site> & { derivAppId?: string; logo?: string | null }>({});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const stepIdx = Math.max(0, Math.min(STEPS.length - 1, Number(params.get('step') ?? (id ? 8 : 0)) || 0));
  const step: Step = id ? STEPS[stepIdx] : 'name';

  useEffect(() => {
    if (!id) return;
    fetch(`/api/sites/${id}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Site not found'))))
      .then((j) => { setSite(j.site); setName(j.site.name); setDraft({}); })
      .catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(() => { if (!id && !params.get('step')) setParams({ step: '0' }, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const view: Site | null = site ? { ...site, ...draft, logoUrl: draft.logo !== undefined ? draft.logo : site.logoUrl } as Site : null;
  const go = (i: number) => { setErrors({}); setError(''); setParams({ step: String(i) }); };

  const save = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!site) return false;
    if (!Object.keys(patch).length) return true;
    setBusy(true); setErrors({}); setError('');
    const r = await fetch(`/api/sites/${site.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(patch) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErrors(j.errors ?? {}); setError(j.errors ? '' : 'Could not save. Try again.'); return false; }
    setSite(j.site); setDraft({});
    return true;
  };

  const next = async () => {
    if (step === 'name') {
      if (!id) {
        setBusy(true); setError('');
        const r = await fetch('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ name }) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setError(j.error ?? 'Could not create the site.');
        // Apply the default template's look and the default tabs straight away.
        const t = templateOf('bothub');
        await fetch(`/api/sites/${j.site.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ accent: t.accent, theme: t.theme, features: DEFAULT_FEATURES }) });
        return navigate(`/sites/${j.site.id}?step=1`, { replace: true });
      }
      if (!(await save({ name }))) return;
    }
    if (step === 'address' && !(await save({ subdomain: draft.subdomain ?? site?.subdomain }))) return;
    if (step === 'features' && !(await save({ features: draft.features ?? site?.features }))) return;
    if (step === 'logo' && !(await save({ ...(draft.logo !== undefined ? { logo: draft.logo } : {}), tagline: draft.tagline ?? site?.tagline ?? '' }))) return;
    if (step === 'design' && draft.template && !(await save({ template: draft.template, accent: draft.accent, theme: draft.theme }))) return;
    if (step === 'colours' && !(await save({ accent: draft.accent ?? site?.accent, theme: draft.theme ?? site?.theme }))) return;
    if (step === 'bots' && draft.free_bots && !(await save({ free_bots: draft.free_bots }))) return;
    if (step === 'deriv' && !(await save({ derivAppId: draft.derivAppId ?? site?.deriv_app_id ?? '', markup: draft.markup ?? site?.markup ?? 0 }))) return;
    if (step === 'review') return publish();
    go(stepIdx + 1);
  };

  const publish = async () => {
    if (!site) return;
    setBusy(true); setError('');
    const r = await fetch(`/api/sites/${site.id}/publish`, { method: 'POST', credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.status === 402) return setError('Activate your account in Billing to publish.');
    if (!r.ok) { setError(j.error ?? 'Could not publish.'); if (j.step === 'deriv') go(STEPS.indexOf('deriv')); return; }
    setSite(j.site);
  };

  const canNext = step === 'name' ? name.trim().length >= 2 : true;

  return (
    <div className="wiz">
      <header className="wiz-top">
        <button className="btn btn-ghost wiz-exit" onClick={() => navigate('/sites')}>Exit</button>
        <div className="wiz-progress" aria-label={`Step ${stepIdx + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => <span key={s} className={i <= stepIdx ? 'on' : ''} onClick={() => id && go(i)} />)}
        </div>
      </header>

      <main className="wiz-body">
        {error && <p className="error" role="alert" style={{ textAlign: 'center' }}>{error}</p>}
        {id && !view ? <p className="muted"><span className="spinner" />Loading…</p> : (
          <>
            {step === 'name' && (
              <section className="wiz-q">
                <h1>What should we call your site?</h1>
                <input className="wiz-big" autoFocus maxLength={40} placeholder="Your site name" value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canNext) void next(); }} aria-label="Site name" />
                {errors.name && <p className="error">{errors.name}</p>}
                <div className="wiz-chips">{SUGGEST.map((s) => <button key={s} onClick={() => setName(s)}>{s}</button>)}</div>
              </section>
            )}

            {step === 'address' && view && (
              <section className="wiz-q">
                <h1>Pick your free address</h1>
                <p>You can add your own domain later.</p>
                <div className="wiz-addr">
                  <span>https://</span>
                  <input value={draft.subdomain ?? view.subdomain} onChange={(e) => setDraft({ ...draft, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) })} aria-label="Subdomain" />
                  <span>.mwasya.site</span>
                </div>
                {errors.subdomain && <p className="error">{errors.subdomain}</p>}
              </section>
            )}

            {step === 'features' && view && (
              <section className="wiz-q">
                <h1>What should visitors be able to do?</h1>
                <p>Choose as many as you like. Login and the dashboard are always on.</p>
                <div className="wiz-options">
                  {SITE_FEATURES.map((f) => {
                    const on = (draft.features ?? view.features).includes(f.id);
                    return (
                      <button key={f.id} className={`wiz-opt ${on ? 'on' : ''}`} aria-pressed={on}
                        onClick={() => { const cur = draft.features ?? view.features; setDraft({ ...draft, features: on ? cur.filter((x) => x !== f.id) : [...cur, f.id] }); }}>
                        <span className="stack" style={{ textAlign: 'left' }}><b>{f.label}</b><span>{f.text}</span></span>
                        <span className="wiz-check">{on ? '✓' : ''}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {step === 'logo' && view && (
              <section className="wiz-q">
                <h1>Add a logo</h1>
                <p>Upload a square PNG, JPG or WebP. We'll use your initials if you skip this.</p>
                <LogoPicker value={view.logoUrl} name={view.name} accent={view.accent} onChange={(logo) => setDraft({ ...draft, logo })} error={errors.logo} />
                <input className="input" maxLength={120} placeholder="Tagline (optional), e.g. Bots that trade while you sleep" value={draft.tagline ?? view.tagline ?? ''} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} aria-label="Tagline" />
                <Preview site={view} />
              </section>
            )}

            {step === 'design' && view && (
              <section className="wiz-q">
                <h1>Designs for {view.name}</h1>
                <div className="wiz-designs">
                  {SITE_TEMPLATES.map((t, i) => {
                    const on = (draft.template ?? view.template) === t.id;
                    return (
                      <button key={t.id} className={`wiz-design ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setDraft({ ...draft, template: t.id, accent: t.accent, theme: t.theme })}
                        style={{ '--d-accent': t.accent, background: t.theme === 'dark' ? '#0B1530' : '#F6F8FC', color: t.theme === 'dark' ? '#fff' : '#0B1F3A' } as CSSProperties}>
                        {i === 0 && <span className="wiz-badge">Best match</span>}
                        <span className="wiz-design-mock"><b>{view.name}</b><i /><i /></span>
                        <span className="stack" style={{ textAlign: 'left' }}><b>{t.name}</b><span style={{ opacity: .7, fontSize: 13 }}>{t.blurb}</span></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {step === 'colours' && view && (
              <section className="wiz-q">
                <h1>Choose your colours</h1>
                <div className="wiz-swatches">
                  {ACCENTS.map((c) => <button key={c} aria-label={c} aria-pressed={view.accent === c} className={view.accent === c ? 'on' : ''} style={{ background: c }} onClick={() => setDraft({ ...draft, accent: c })} />)}
                  <label className="wiz-custom">Custom <input type="color" value={view.accent} onChange={(e) => setDraft({ ...draft, accent: e.target.value.toUpperCase() })} /></label>
                </div>
                <div className="seg" style={{ maxWidth: 320, margin: '0 auto' }}>
                  {(['dark', 'light'] as const).map((t) => <button key={t} className={view.theme === t ? 'on' : ''} aria-pressed={view.theme === t} onClick={() => setDraft({ ...draft, theme: t })}>{t === 'dark' ? 'Dark' : 'Light'}</button>)}
                </div>
                <Preview site={view} />
              </section>
            )}

            {step === 'bots' && view && <BotsStep site={view} selected={draft.free_bots ?? view.free_bots} onChange={(ids) => setDraft({ ...draft, free_bots: ids })} />}

            {step === 'deriv' && view && (
              <section className="wiz-q">
                <h1>Connect your Deriv app</h1>
                <p>Your clients log in through <b>your</b> Deriv app, so Deriv pays the markup straight to you.</p>
                <ol className="wiz-howto">
                  <li>Open <a href="https://developers.deriv.com" target="_blank" rel="noreferrer">developers.deriv.com</a> and register an app with the <b>trade</b> scope.</li>
                  <li>Add these redirect URIs:
                    <code className="mono">{view.subdomainUrl}/callback</code>
                    {view.custom_domain && <code className="mono">https://{view.custom_domain}/callback</code>}
                  </li>
                  <li>Set your markup there, then paste the App ID below.</li>
                </ol>
                <input className="wiz-big mono" style={{ fontSize: 22 }} placeholder="App ID" value={draft.derivAppId ?? view.deriv_app_id ?? ''} onChange={(e) => setDraft({ ...draft, derivAppId: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} aria-label="Deriv App ID" />
                {errors.derivAppId && <p className="error">{errors.derivAppId}</p>}
                <label className="stack" style={{ gap: 6, maxWidth: 360, margin: '0 auto', width: '100%' }}>
                  <span className="row" style={{ justifyContent: 'space-between' }}><span>Markup (same as on Deriv)</span><b className="mono">{(draft.markup ?? view.markup).toFixed(1)}%</b></span>
                  <input type="range" min={0} max={3} step={0.5} value={draft.markup ?? view.markup} onChange={(e) => setDraft({ ...draft, markup: Number(e.target.value) })} />
                </label>
              </section>
            )}

            {step === 'domain' && view && (
              <section className="wiz-q">
                <h1>Your address</h1>
                <p>Live now on <span className="mono">{view.subdomain}.mwasya.site</span>. Buy a domain or connect one you own.</p>
                <div className="wiz-panel"><DomainStep siteId={view.id} onChange={() => fetch(`/api/sites/${view.id}`, { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setSite(j.site))} /></div>
              </section>
            )}

            {step === 'review' && view && (
              <section className="wiz-q">
                <h1>{view.status === 'live' ? `${view.name} is live` : 'Ready to deploy'}</h1>
                <Preview site={view} />
                <ul className="wiz-review">
                  <li><span>Address</span><b className="mono">{view.custom_domain ?? `${view.subdomain}.mwasya.site`}</b></li>
                  <li><span>Design</span><b>{templateOf(view.template).name}</b></li>
                  <li><span>Tabs</span><b>{view.features.length}</b></li>
                  <li><span>Free bots</span><b>{view.free_bots.length || 'All your published files'}</b></li>
                  <li><span>Deriv app</span><b className="mono">{view.deriv_app_id ?? <span className="error">Missing</span>}</b></li>
                </ul>
                <a className="btn btn-secondary" style={{ alignSelf: 'center' }} href={`/preview/${view.id}`} target="_blank" rel="noreferrer">Preview as a client ↗</a>
                {view.ready && <div className="wiz-panel"><ReadyChecklist siteId={view.id} ready={view.ready} /></div>}
                {view.status === 'live' && <a className="btn btn-secondary" href={view.url} target="_blank" rel="noreferrer">Open {view.url.replace('https://', '')} ↗</a>}
                {!auth.operator && <p className="error">Log in again to publish.</p>}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="wiz-foot">
        <button className="btn btn-ghost" disabled={stepIdx === 0 || busy} onClick={() => go(stepIdx - 1)}>‹ Back</button>
        <button className="btn wiz-next" disabled={!canNext || busy} onClick={next}>
          {busy ? 'Saving…' : step === 'review' ? (view?.status === 'live' ? 'Save & redeploy' : 'Deploy site') : 'Continue'}
        </button>
      </footer>
    </div>
  );
}

function LogoPicker({ value, name, accent, onChange, error }: { value: string | null; name: string; accent: string; onChange: (v: string | null) => void; error?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const pick = (f: File | undefined) => {
    setMsg('');
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setMsg('Use PNG, JPG or WebP (SVG is not allowed).');
    // Resize to 256×256 in the browser so uploads stay small.
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 256;
      const ctx = c.getContext('2d')!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      const url = c.toDataURL('image/png');
      URL.revokeObjectURL(img.src);
      if (url.length > 190_000) return setMsg('That image is too detailed. Try a simpler logo.');
      onChange(url);
    };
    img.onerror = () => setMsg('Could not read that image.');
    img.src = URL.createObjectURL(f);
  };
  return (
    <div className="row" style={{ gap: 16, alignItems: 'center', justifyContent: 'center' }}>
      {value ? <img className="wiz-logo" src={value} alt="Logo" /> : <span className="wiz-logo" style={{ background: accent }}>{name.slice(0, 2).toUpperCase()}</span>}
      <div className="stack" style={{ gap: 8 }}>
        <button className="btn btn-secondary" onClick={() => input.current?.click()}>Upload logo</button>
        {value && <button className="btn btn-ghost" onClick={() => onChange(null)}>Remove</button>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {(msg || error) && <p className="error" style={{ width: '100%', textAlign: 'center' }}>{msg || error}</p>}
    </div>
  );
}

function Preview({ site }: { site: Site }) {
  const t = templateOf(site.template);
  const dark = site.theme === 'dark';
  const tabs = SITE_FEATURES.filter((f) => site.features.includes(f.id) && f.id !== 'learn' && f.id !== 'deposit').slice(0, 4);
  return (
    <div className="wiz-preview" style={{ '--p-accent': site.accent, background: dark ? '#0B1530' : '#fff', color: dark ? '#E6ECF5' : '#0B1F3A' } as CSSProperties} aria-label="Live preview">
      <div className="wp-bar"><span /><span /><span /><em>{site.custom_domain ?? `${site.subdomain}.mwasya.site`}</em></div>
      <div className="wp-head">
        {site.logoUrl ? <img src={site.logoUrl} alt="" /> : <i style={{ background: site.accent }}>{site.name.slice(0, 2).toUpperCase()}</i>}
        <b>{site.name}</b>
        {site.features.includes('deposit') && <u>Deposit</u>}
      </div>
      <div className="wp-tabs">{['Dashboard', ...tabs.map((x) => x.label)].map((l, i) => <span key={l} className={i === 0 ? 'on' : ''}>{l}</span>)}</div>
      <div className="wp-hero">
        <small>● LIVE MARKETS</small>
        <strong>{t.name} · {site.name}</strong>
        <p>{site.tagline || t.hero}</p>
        <span className="row" style={{ gap: 8 }}><u>Start trading</u><s>Explore bots</s></span>
      </div>
    </div>
  );
}

function BotsStep({ site, selected, onChange }: { site: Site; selected: string[]; onChange: (ids: string[]) => void }) {
  const [bots, setBots] = useState<CatalogBot[] | null>(null);
  const [q, setQ] = useState('');
  const [upName, setUpName] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => fetch('/api/sites/catalog', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => setBots(j.bots ?? [])).catch(() => setBots([]));
  useEffect(() => { void load(); }, []);
  // First visit with nothing chosen: pre-select everything.
  const sel = useMemo(() => new Set(selected.length || !bots ? selected : bots.map((b) => b.id)), [selected, bots]);
  useEffect(() => { if (bots && !selected.length && bots.length) onChange(bots.map((b) => b.id)); }, [bots]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f: File | undefined) => {
    setMsg('');
    if (!f) return;
    if (!/\.xml$/i.test(f.name) || f.size > 400_000) return setMsg('Choose a Deriv Bot .xml file under 400 KB.');
    const r = await fetch('/api/xmlbots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ name: upName || f.name.replace(/\.xml$/i, ''), xml: await f.text() }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error && j.error !== 'server_error' ? j.error : 'Upload failed.');
    setUpName('');
    await load();
    onChange([...sel, j.bot.id]);
  };

  const shown = (bots ?? []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="wiz-q">
      <h1>Which free bots should appear?</h1>
      <p>These show on the Free Bots page of {site.name}.</p>
      <div className="wiz-panel stack" style={{ gap: 12 }}>
        <b style={{ color: 'var(--success)' }}>{sel.size} selected</b>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: '1 1 200px' }} placeholder="Name for your bot, e.g. Over 2 Recovery" value={upName} onChange={(e) => setUpName(e.target.value)} />
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>Upload .xml</button>
          <input ref={fileRef} type="file" accept=".xml" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {msg && <p className="error">{msg}</p>}
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} type="search" placeholder="Search bots…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-secondary" onClick={() => onChange((bots ?? []).map((b) => b.id))}>Select all</button>
          <button className="btn btn-secondary" onClick={() => onChange([])}>Clear</button>
        </div>
        {bots === null ? <p className="muted"><span className="spinner" />Loading…</p> : bots.length === 0 ? <p className="muted">No bots yet. Upload a Deriv Bot .xml file above.</p> : (
          <ul className="wiz-bots">
            {shown.map((b) => (
              <li key={b.id}>
                <label>
                  <input type="checkbox" checked={sel.has(b.id)} onChange={(e) => onChange(e.target.checked ? [...sel, b.id] : [...sel].filter((x) => x !== b.id))} />
                  <span className="stack"><b>{b.name}</b><span className="hint">{b.mine ? 'Your bot' : 'Catalog'}{b.description ? ` · ${b.description}` : ''}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
