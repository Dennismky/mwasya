import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { startLogin } from '../lib/derivAuth';
import { ACCENTS, MAX_MARKUP, cleanSubdomain, isBadBrandName, useSiteConfig } from '../store/siteConfig';

const STEPS = ['Brand', 'Look', 'Deriv app', 'Domain'] as const;

interface LiveSite { url: string; subdomain: string }

export default function Setup() {
  const site = useSiteConfig();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<LiveSite | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [publishError, setPublishError] = useState('');

  // Load the saved site (the server is the source of truth once published).
  useEffect(() => {
    if (!auth.operator) return;
    fetch('/api/sites/mine', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { site: null | { name: string; subdomain: string; accent: string; theme: 'light' | 'dark'; derivAppId: string; markup: number; url: string } } | null) => {
        if (!j?.site) return;
        const s = j.site;
        site.update({ name: s.name, subdomain: s.subdomain, accent: s.accent, theme: s.theme, derivAppId: s.derivAppId, markup: s.markup, domainMode: 'sub' });
        setLive({ url: s.url, subdomain: s.subdomain });
      })
      .catch(() => undefined);
  }, [auth.operator]); // eslint-disable-line react-hooks/exhaustive-deps

  async function publish() {
    setPublishing(true); setPublishError(''); setErrors({});
    try {
      const r = await fetch('/api/sites/mine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: site.name, subdomain: site.subdomain, accent: site.accent, theme: site.theme, derivAppId: site.derivAppId, markup: site.markup }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { setPublishError('Log in again to publish your site.'); return; }
      if (r.status === 422 || r.status === 409) {
        setErrors(j.errors ?? {});
        const first = Object.keys(j.errors ?? {})[0];
        setStep(first === 'name' || first === 'subdomain' ? 0 : first === 'accent' ? 1 : first === 'derivAppId' || first === 'markup' ? 2 : step);
        return;
      }
      if (!r.ok) throw new Error('Could not publish your site. Please try again.');
      setLive({ url: j.site.url, subdomain: j.site.subdomain });
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  const domain = `${site.subdomain || "yourbrand"}.mwasya.site`;
  const redirect = `https://${domain}/callback`;
  const nameBad = isBadBrandName(site.name);
  const canContinue = [
    site.name.trim().length > 1 && !nameBad && site.subdomain.length > 2,
    true,
    /^[A-Za-z0-9_-]{2,64}$/.test(site.derivAppId),
    true,
  ][step];

  const copy = async () => {
    try { await navigator.clipboard.writeText(redirect); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>My site</h1>
          <p className="muted">Your branded site where traders log in and run your published bots. Step {step + 1} of {STEPS.length}.</p>
        </div>
        {live && <a className="btn btn-secondary" href={live.url} target="_blank" rel="noreferrer">Open {live.subdomain}.mwasya.site ↗</a>}
      </div>

      {!auth.operator && (
        <div className="notice">
          <span><b>Log in again to publish.</b> We need to link your Deriv login to your Mwasya workspace.</span>
          <button className="btn btn-primary" onClick={() => startLogin({ returnTo: '/setup' })}>Log in again</button>
        </div>
      )}
      {live && (
        <div className="notice" style={{ background: 'var(--success-tint)', borderColor: '#BFE6D4' }}>
          <span><b>Your site is live</b> at <a href={live.url} target="_blank" rel="noreferrer">{live.url.replace('https://', '')}</a>. Bots you publish in <Link to="/forge">Bot Forge</Link> appear there.</span>
        </div>
      )}

      <div className="stack" style={{ gap: 28 }}>
        <nav aria-label="Setup steps" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {STEPS.map((label, i) => {
            const current = i === step;
            return (
              <button key={label} type="button" onClick={() => setStep(i)} aria-current={current ? 'step' : undefined}
                className="row" style={{ alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', font: 'inherit', color: 'var(--text)', textAlign: 'left',
                  border: `1px solid ${current ? 'var(--primary)' : 'var(--border)'}`, background: current ? 'var(--primary-tint)' : '#fff',
                  boxShadow: current ? '0 0 0 3px rgba(31,79,209,0.18)' : 'none' }}>
                <span style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border-strong)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13 }}>{i < step ? '✓' : i + 1}</span>
                <span className="stack"><span className="hint" style={{ fontSize: 12, fontWeight: 600 }}>STEP {i + 1}</span><b style={{ fontSize: 15 }}>{label}</b></span>
              </button>
            );
          })}
        </nav>

        <div className="row" style={{ gap: 28, alignItems: 'flex-start' }}>
          <section className="card stack" style={{ flex: '999 1 560px', minWidth: 0, gap: 24, padding: 32 }}>
            {step === 0 && (
              <>
                <Heading title="Name your brand" sub={'This is what your traders will see. Deriv doesn\'t allow "Deriv" or "Binary" in app names.'} />
                <div className="field">
                  <label className="label" htmlFor="brand">Site name</label>
                  <input id="brand" className="input" value={site.name} maxLength={40} onChange={(e) => site.update({ name: e.target.value })} aria-invalid={nameBad} aria-describedby="brand-err" />
                  {nameBad && <span id="brand-err" className="error" role="alert">Remove "Deriv" or "Binary" from the name.</span>}
                  {errors.name && <span className="error">{errors.name}</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="sub">Free address</label>
                  <div className="input-group">
                    <input id="sub" className="input mono" value={site.subdomain} onChange={(e) => site.update({ subdomain: cleanSubdomain(e.target.value) })} />
                  {errors.subdomain && <span className="error">{errors.subdomain}</span>}
                    <span className="addon">.mwasya.site</span>
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <Heading title="Pick your look" sub="Your accent color is used for buttons and highlights." />
                <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                  <legend className="label" style={{ marginBottom: 12 }}>Accent color</legend>
                  <div className="row" style={{ gap: 14 }}>
                    {ACCENTS.map((a) => (
                      <button key={a.hex} type="button" aria-label={a.name} aria-pressed={site.accent === a.hex} onClick={() => site.update({ accent: a.hex })}
                        style={{ width: 52, height: 52, borderRadius: 12, background: a.hex, cursor: 'pointer', border: `3px solid ${site.accent === a.hex ? '#fff' : a.hex}`, boxShadow: site.accent === a.hex ? `0 0 0 3px ${a.hex}` : 'none' }} />
                    ))}
                  </div>
                </fieldset>
                <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                  <legend className="label" style={{ marginBottom: 12 }}>Theme</legend>
                  <div className="row" style={{ gap: 10 }}>
                    {(['light', 'dark'] as const).map((t) => (
                      <button key={t} type="button" aria-pressed={site.theme === t} onClick={() => site.update({ theme: t })}
                        className={`btn ${site.theme === t ? 'btn-primary' : 'btn-secondary'}`} style={{ textTransform: 'capitalize' }}>{t}</button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}

            {step === 2 && (
              <>
                <Heading title="Connect your Deriv app" sub="Register an app at developers.deriv.com and paste its app ID here. We never ask for your Deriv password or tokens." />
                <div className="stack" style={{ gap: 8, padding: 16, borderRadius: 10, background: 'var(--primary-tint)', border: '1px solid #D5DEF5' }}>
                  <b style={{ fontSize: 14 }}>Set this as your redirect URI on Deriv:</b>
                  <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <code className="mono" style={{ flex: 1, minWidth: 0, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', fontSize: 13, overflowWrap: 'anywhere' }}>{redirect}</code>
                    <button type="button" className="btn btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
                  </div>
                </div>
                <div className="field">
                  <label className="label" htmlFor="appid">Deriv app ID</label>
                  <input id="appid" className="input mono" placeholder="e.g. 34RhH6jeO22uI72af7k8B" value={site.derivAppId} onChange={(e) => site.update({ derivAppId: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} />
                  {errors.derivAppId ? <span className="error">{errors.derivAppId}</span> : <span className="hint">Use your <b>own</b> Deriv app so the markup is paid to you. The App ID is public, so it's safe to share.</span>}
                </div>
                <div className="field">
                  <label className="label" htmlFor="markup" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Your markup</span><span className="mono">{site.markup.toFixed(1)}%</span>
                  </label>
                  <input id="markup" type="range" min={0} max={MAX_MARKUP} step={0.5} value={site.markup}
                    onChange={(e) => site.update({ markup: Number(e.target.value) })} aria-valuetext={`${site.markup}%`} />
                  <div className="row hint" style={{ justifyContent: 'space-between' }}><span>0%</span><span>{MAX_MARKUP}% max</span></div>
                  <span className="hint">Set the same value in your Deriv app settings. Deriv pays it to you on every trade.</span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="badge badge-green">Scope: trade</span>
                  <span className="badge" style={{ background: 'var(--bg-alt)', color: 'var(--muted)', textDecoration: 'line-through' }}>payment</span>
                  <span className="badge" style={{ background: 'var(--bg-alt)', color: 'var(--muted)', textDecoration: 'line-through' }}>account_manage</span>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <Heading title="Choose your address" sub="Go live on your free subdomain now. You can connect your own domain at any time." />
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  {(['sub', 'custom'] as const).map((m) => {
                    const on = site.domainMode === m;
                    return (
                      <button key={m} type="button" aria-pressed={on} disabled={m === 'custom'} onClick={() => site.update({ domainMode: m })} className="stack"
                        style={{ alignItems: 'flex-start', gap: 6, padding: 18, borderRadius: 10, cursor: 'pointer', font: 'inherit', color: 'var(--text)', textAlign: 'left',
                          border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`, background: on ? 'var(--primary-tint)' : '#fff', boxShadow: on ? '0 0 0 3px rgba(31,79,209,0.18)' : 'none' }}>
                        <b>{m === 'sub' ? 'Free subdomain' : 'My own domain'}</b>
                        <span className={m === 'sub' ? 'mono hint' : 'hint'}>{m === 'sub' ? `${site.subdomain}.mwasya.site` : 'Coming soon'}</span>
                      </button>
                    );
                  })}
                </div>
                {site.domainMode === 'custom' && (
                  <div className="stack" style={{ gap: 14 }}>
                    <div className="field">
                      <label className="label" htmlFor="dom">Your domain</label>
                      <input id="dom" className="input mono" placeholder="trade.yourbrand.com" value={site.customDomain}
                        onChange={(e) => site.update({ customDomain: e.target.value.trim().toLowerCase() })} />
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto' }}>
                      <table className="table">
                        <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                        <tbody className="mono">
                          <tr><td>CNAME</td><td>{site.customDomain || 'your domain'}</td><td>sites.mwasya.site</td></tr>
                          <tr><td>TXT</td><td>_mwasya-verify</td><td>mw-verify-[CODE]</td></tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="row" style={{ justifyContent: 'space-between', gap: 12, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn-primary" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>Continue</button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!canContinue || publishing || !auth.operator} onClick={publish}>{publishing ? 'Publishing…' : live ? 'Save & republish' : 'Publish site'}</button>
              )}
            </div>
            {publishError && <p className="error" role="alert">{publishError}</p>}
          </section>

          <aside aria-label="Live preview" className="stack" style={{ flex: '1 1 360px', minWidth: 0, gap: 12 }}>
            <span className="hint" style={{ fontWeight: 600, letterSpacing: '0.04em' }}>LIVE PREVIEW</span>
            <Preview domain={domain} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{title}</h1>
      <p className="muted" style={{ fontSize: 16 }}>{sub}</p>
    </div>
  );
}

function Preview({ domain }: { domain: string }) {
  const site = useSiteConfig();
  const dark = site.theme === 'dark';
  const name = site.name || 'YourBrand';
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', background: '#fff' }}>
      <div className="row" style={{ alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-alt)' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--border)' }} />)}
        <span className="mono muted" style={{ marginLeft: 8, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{domain}</span>
      </div>
      <div className="stack" style={{ padding: 26, gap: 18, minHeight: 340, background: dark ? '#0B1F3A' : '#fff', color: dark ? '#F5F7FA' : 'var(--text)' }}>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, background: site.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{name.charAt(0).toUpperCase()}</span>
          <b style={{ fontSize: 18 }}>{name}</b>
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>Trade with {name}</div>
        <span style={{ alignSelf: 'flex-start', padding: '11px 18px', borderRadius: 8, background: site.accent, color: '#fff', fontWeight: 600 }}>Log in with Deriv</span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Markup {site.markup.toFixed(1)}% · App ID {site.derivAppId || '—'}</span>
      </div>
    </div>
  );
}
