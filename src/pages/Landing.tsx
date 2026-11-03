import { Link } from 'react-router-dom';
import { Brand, Feature, Footer, Icon } from '../components/ui';
import { MAX_MARKUP } from '../store/siteConfig';

const plans = [
  { name: 'Starter', blurb: 'For your first site', items: ['1 branded site', 'mwasya.site address', '5 bots', 'Basic analytics'], cta: 'Get started' },
  { name: 'Pro', blurb: 'For growing brands', items: ['3 branded sites', 'Custom domains', 'Unlimited Bot Forge', 'Telegram signals'], cta: 'Get started', featured: true },
  { name: 'Agency', blurb: 'For teams running many brands', items: ['Unlimited sites', 'Team seats', 'Priority support', 'White-label studio'], cta: 'Contact sales' },
];

const faqs = [
  ['Do I need a Deriv account?', "Yes. You register your own app on Deriv's developer portal, and your traders log in with their own Deriv accounts."],
  ['How do I earn money?', `You set a markup of up to ${MAX_MARKUP}% on your Deriv app. Deriv pays it to you on every trade placed through your site.`],
  ["Can Mwasya access my traders' funds?", 'No. Sites only request trade access, so neither you nor Mwasya can withdraw or move funds.'],
  ['Can I use my own domain?', 'Yes, on the Pro and Agency plans. Add two DNS records and SSL is set up automatically.'],
];

export default function Landing() {
  return (
    <>
      <header className="nav">
        <nav className="container nav-inner" aria-label="Main">
          <Brand />
          <div className="nav-links">
            <a href="#product">Product</a>
            <a href="#security">Security</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn btn-ghost" to="/app">Sign in</Link>
            <Link className="btn btn-primary" to="/setup">Get started</Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="alt" style={{ borderTop: 'none' }}>
          <div className="container row" style={{ padding: '80px 24px', gap: 56, alignItems: 'center' }}>
            <div className="stack" style={{ flex: '1 1 460px', minWidth: 0, gap: 24 }}>
              <span className="badge badge-blue" style={{ alignSelf: 'flex-start', fontSize: 13 }}>The operator platform for Deriv</span>
              <h1 style={{ fontSize: 'clamp(40px, 5vw, 60px)', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.03em' }}>
                Launch and grow your Deriv trading business
              </h1>
              <p className="lead" style={{ fontSize: 19, maxWidth: 540 }}>
                Run branded trading sites, build bots from plain-English strategies and send signals to Telegram, all from one secure workspace.
              </p>
              <div className="row" style={{ gap: 12 }}>
                <Link className="btn btn-primary btn-lg" to="/setup">Start free <Icon.Arrow /></Link>
                <Link className="btn btn-secondary btn-lg" to="/app">View a live demo</Link>
              </div>
              <span className="muted" style={{ fontSize: 14 }}>Free to start · No card required · Cancel anytime</span>
            </div>
            <ProductMock />
          </div>
        </section>

        {/* Trust strip */}
        <section aria-label="Platform guarantees" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="container" style={{ padding: '28px 24px', display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', fontSize: 14, fontWeight: 600 }}>
            {[[<Icon.Lock />, 'Official Deriv OAuth sign-in'], [<Icon.Shield />, 'Trade access only'], [<Icon.Key />, 'Secrets encrypted at rest'], [<Icon.Globe />, 'Custom domains with SSL']].map(([icon, text], i) => (
              <span key={i} className="row" style={{ alignItems: 'center', gap: 10 }}><span style={{ color: 'var(--primary)', display: 'flex' }}>{icon}</span>{text}</span>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="product" className="section">
          <div className="container stack" style={{ gap: 48 }}>
            <div className="stack" style={{ maxWidth: 680, gap: 14 }}>
              <span className="eyebrow">Product</span>
              <h2 className="h2">Everything you need to run a trading brand</h2>
              <p className="lead">Build, launch and manage your Deriv sites without writing code or handling your traders' credentials.</p>
            </div>
            <div className="grid">
              <Feature icon={<Icon.Window />} title="Branded trading sites">Your name, logo and colors on a full Deriv trading site. Traders sign in with their own Deriv account.</Feature>
              <Feature icon={<Icon.Chip />} title="Bot Forge">Describe a strategy in plain English and get a Deriv bot. Each bot is checked and given loss limits before it can run.</Feature>
              <Feature icon={<Icon.Send />} title="Telegram signals">Write a signal once and send it to your channel, formatted and branded.</Feature>
              <Feature icon={<Icon.Coin />} title={`Up to ${MAX_MARKUP}% markup`}>Set your markup on your Deriv app. Deriv pays it straight to your account on every trade.</Feature>
              <Feature icon={<Icon.Globe />} title="Custom domains">Start on a free mwasya.site address, then connect your own domain with two DNS records.</Feature>
              <Feature icon={<Icon.Chart />} title="Multi-site analytics">See sign-ups, active traders, bot runs and earnings for every site you run.</Feature>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="section alt">
          <div className="container stack" style={{ gap: 48 }}>
            <div className="stack" style={{ gap: 14 }}>
              <span className="eyebrow">How it works</span>
              <h2 className="h2">Live in three steps</h2>
            </div>
            <ol className="grid" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 32 }}>
              {[
                ['Register your Deriv app', 'Create an app at developers.deriv.com and paste in its app ID. Your account and earnings stay yours.'],
                ['Brand your site and add bots', 'Choose your name, colors and logo, then build bots in Bot Forge or start from a template.'],
                ['Publish and share', 'Go live on your mwasya.site address or your own domain, and share it with your community.'],
              ].map(([t, d], i) => (
                <li key={t} className="stack" style={{ gap: 12, borderTop: `2px solid ${i === 0 ? 'var(--primary)' : 'var(--border)'}`, paddingTop: 20 }}>
                  <span className="mono" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 14 }}>0{i + 1}</span>
                  <h3 style={{ fontSize: 18, fontWeight: 600 }}>{t}</h3>
                  <p className="muted" style={{ fontSize: 15, lineHeight: 1.6 }}>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="section" style={{ background: 'var(--navy)', color: '#fff' }}>
          <div className="container row" style={{ gap: 56, alignItems: 'flex-start' }}>
            <div className="stack" style={{ flex: '1 1 380px', gap: 16 }}>
              <span className="eyebrow" style={{ color: '#9DB7FF' }}>Security</span>
              <h2 className="h2">Your traders' accounts stay theirs</h2>
              <p style={{ fontSize: 17, lineHeight: 1.6, color: '#C9D3E3' }}>Many bot sites ask traders to paste an API token, and that's how accounts get drained. Mwasya never asks for one.</p>
            </div>
            <dl style={{ flex: '1 1 520px', margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '28px 32px' }}>
              {[
                ['Deriv OAuth only', 'Traders sign in on Deriv. We never see a password or permanent token.'],
                ['Least privilege', 'Sites request trade access only. They never get payment or account management.'],
                ['Encrypted secrets', 'Login tokens live in encrypted, HttpOnly cookies that page scripts cannot read.'],
                ['Checked bots', 'Every bot is checked against a list of allowed blocks before anyone can run it.'],
              ].map(([t, d]) => (
                <div key={t} className="stack" style={{ gap: 6, borderTop: '1px solid #2A3F63', paddingTop: 18 }}>
                  <dt style={{ fontWeight: 600 }}>{t}</dt>
                  <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#C9D3E3' }}>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="section">
          <div className="container stack" style={{ gap: 48 }}>
            <div className="stack" style={{ gap: 14 }}>
              <span className="eyebrow">Pricing</span>
              <h2 className="h2">Plans that grow with you</h2>
            </div>
            <div className="grid" style={{ alignItems: 'stretch' }}>
              {plans.map((p) => (
                <div key={p.name} className="card stack" style={{ gap: 18, border: p.featured ? '2px solid var(--primary)' : undefined, boxShadow: p.featured ? '0 16px 40px rgba(31,79,209,0.12)' : undefined }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                    <div><h3 style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</h3><p className="muted" style={{ fontSize: 14 }}>{p.blurb}</p></div>
                    {p.featured && <span className="badge badge-blue">Most popular</span>}
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>[YOUR PRICE]<span className="muted" style={{ fontSize: 15, fontWeight: 500 }}> / month</span></div>
                  <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 10, fontSize: 15 }}>
                    {p.items.map((i) => <li key={i}>✓ {i}</li>)}
                  </ul>
                  <Link className={`btn ${p.featured ? 'btn-primary' : 'btn-secondary'}`} to="/setup" style={{ marginTop: 'auto' }}>{p.cta}</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="section alt">
          <div className="container stack" style={{ maxWidth: 820, gap: 32 }}>
            <h2 className="h2">Frequently asked questions</h2>
            <div style={{ borderTop: '1px solid var(--border)' }}>
              {faqs.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}<span aria-hidden="true" style={{ color: 'var(--primary)' }}>+</span></summary>
                  <p className="muted" style={{ marginTop: 12, fontSize: 15, lineHeight: 1.6 }}>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="section">
          <div className="container">
            <div className="row" style={{ borderRadius: 16, background: 'var(--navy)', color: '#fff', padding: '56px 48px', gap: 28, alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="stack" style={{ gap: 10, maxWidth: 620 }}>
                <h2 style={{ fontSize: 'clamp(28px, 3vw, 38px)', fontWeight: 700 }}>Start your trading brand today</h2>
                <p style={{ fontSize: 17, color: '#C9D3E3' }}>Set up your first site in minutes. No card required.</p>
              </div>
              <Link className="btn btn-primary btn-lg" to="/setup">Start free</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function ProductMock() {
  const rows = [['Digit Over 3', '184', 'Live'], ['Even/Odd Flip', '96', 'Live'], ['Boom Spike', '32', 'Draft']];
  return (
    <div aria-hidden="true" style={{ flex: '1 1 520px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 12, background: '#fff', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
      <div className="row" style={{ alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-alt)' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--border)' }} />)}
        <span className="mono muted" style={{ marginLeft: 10, fontSize: 12 }}>app.mwasya.site/overview</span>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {[['Active traders', '46'], ['Bot runs', '312'], [`Markup (${MAX_MARKUP}%)`, '$84.20']].map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Earnings, last 14 days (sample)</div>
          <svg viewBox="0 0 400 100" style={{ width: '100%', height: 100 }} fill="none">
            <path d="M0 85 H400 M0 55 H400 M0 25 H400" stroke="#EEF1F6" />
            <path d="M0 80 L30 74 L60 76 L90 62 L120 66 L150 52 L180 56 L210 44 L240 48 L270 34 L300 38 L330 26 L360 30 L400 18" stroke="#1F4FD1" strokeWidth="2.5" strokeLinejoin="round" />
          </svg>
        </div>
        <table className="table" style={{ border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
          <thead><tr><th>Bot</th><th>Runs</th><th>Status</th></tr></thead>
          <tbody>{rows.map(([b, r, s]) => <tr key={b}><td>{b}</td><td>{r}</td><td style={{ color: s === 'Live' ? 'var(--success)' : 'var(--muted)', fontWeight: 600 }}>{s}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
