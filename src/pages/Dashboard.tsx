import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import { startLogin } from '../lib/derivAuth';
import { useT } from '../lib/i18n';

interface MySite { name: string; subdomain: string; url: string }
interface Summary { people: number; sites: number }

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** `/app` on mwasya.site — the mentor's business overview. No trading and no balances here: that happens on their trading site. */
export default function Dashboard() {
  const auth = useAuth();
  const t = useT();
  const [site, setSite] = useState<MySite | null | undefined>(undefined);
  const [bots, setBots] = useState<number | null>(null);
  const [xml, setXml] = useState<number | null>(null);
  const [network, setNetwork] = useState<Summary | null>(null);
  const [earned, setEarned] = useState<number | 'connect' | null>(null);

  useEffect(() => {
    if (!auth.operator) return;
    const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    void get('/api/sites/mine').then((j) => setSite(j?.site ?? null));
    void get('/api/bots').then((j) => setBots(j ? (j.bots as { status: string }[]).filter((b) => b.status === 'published').length : 0));
    void get('/api/xmlbots').then((j) => setXml(j ? (j.bots as { status: string }[]).filter((b) => b.status === 'published').length : 0));
    void get('/api/network').then((j) => setNetwork(j?.summary ?? null));
    void get('/api/commissions').then((j) => setEarned(j?.needsScope ? 'connect' : j?.data ? Number(j.data.total_app_markup_usd ?? 0) : null));
  }, [auth.operator]);

  const steps = [
    { done: auth.accounts.length > 0, title: 'Connect your Deriv account', text: 'You log in with Deriv. We only get trade access and never see your password.' },
    { done: !!site, title: 'Create your trading site', text: 'Your brand, your colours and your own Deriv app, so the markup is paid to you.', to: '/setup', cta: 'Create site' },
    { done: (bots ?? 0) + (xml ?? 0) > 0, title: 'Give your clients bots', text: 'Publish a Bot Forge bot or upload Deriv Bot XML files.', to: '/forge', cta: 'Open Bot Forge' },
    { done: (network?.people ?? 0) > 0, title: 'Bring in other mentors', text: 'Share an invite link. They get their own site, under you.', to: '/network', cta: 'Invite' },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('nav.overview')}</h1>
          <p className="muted">Build your trading site, give your clients bots, grow your network and earn markup on every trade.</p>
        </div>
        {site && <a className="btn btn-primary" href={site.url} target="_blank" rel="noreferrer"><Icon.Globe /> Open {site.subdomain}.mwasya.site</a>}
      </div>

      {!auth.operator && (
        <div className="notice">
          <div className="stack" style={{ gap: 4 }}>
            <b>Finish linking your workspace</b>
            <span className="hint">Log in once more so we can save your site and bots.</span>
          </div>
          <button className="btn btn-primary" onClick={() => startLogin({ returnTo: '/app' })}>Log in again</button>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Tile label="MARKUP · 30 DAYS" value={earned === 'connect' ? undefined : earned === null ? '—' : usd(earned)} action={earned === 'connect' ? <Link to="/commissions" className="hint">Connect earnings →</Link> : <Link to="/commissions" className="hint">View commissions →</Link>} strong />
        <Tile label="MENTORS UNDER YOU" value={network ? String(network.people) : '—'} action={<Link to="/network" className="hint">Open network →</Link>} />
        <Tile label="SITES IN YOUR NETWORK" value={network ? String(network.sites) : '—'} />
        <Tile label="BOTS ON YOUR SITE" value={bots === null || xml === null ? '—' : String(bots + xml)} action={<Link to="/xml-bots" className="hint">XML bots →</Link>} />
      </div>

      <section className="card stack" style={{ gap: 18, maxWidth: 820 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Let's get you live</h2>
          <p className="muted">{done} of {steps.length} complete</p>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          <span style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.title} className={`step ${s.done ? 'step-done' : ''}`}>
              <span className="step-num" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
              <div className="stack" style={{ gap: 4, flex: 1 }}>
                <b>{s.title}</b>
                <span className="hint">{s.text}</span>
              </div>
              {!s.done && s.to && <Link className="btn btn-secondary" to={s.to}>{s.cta} <Icon.Arrow /></Link>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Tile({ label, value, action, strong }: { label: string; value?: string; action?: React.ReactNode; strong?: boolean }) {
  return (
    <section className="card stack" style={{ gap: 6, padding: 20 }}>
      <span className="hint" style={{ fontWeight: 600 }}>{label}</span>
      {value !== undefined && <b className="mono" style={{ fontSize: 28, color: strong ? 'var(--success)' : undefined }}>{value}</b>}
      {action}
    </section>
  );
}
