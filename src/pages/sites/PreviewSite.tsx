import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublishedBot, SiteBranding } from '../../lib/tenant';
import TraderApp, { type XmlBotLite } from '../../trader/TraderApp';

/** `/preview/:id/*` — the mentor sees their trading site exactly as a client would (no login, trading off). */
export default function PreviewSite() {
  const { id } = useParams();
  const [data, setData] = useState<{ site: SiteBranding; bots: PublishedBot[]; xml: XmlBotLite[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then((r) => {
        if (r.status === 401) throw new Error('Log in on mwasya.site first, then open the preview again.');
        if (!r.ok) throw new Error('Could not load this site.');
        return r.json();
      });
      const [{ site: s }, { bots }, { bots: catalog }] = await Promise.all([get(`/api/sites/${id}`), get('/api/bots'), get('/api/sites/catalog')]);
      const picked = new Set<string>(s.free_bots ?? []);
      const xml = (catalog as (XmlBotLite & { mine: boolean })[]).filter((b) => (picked.size ? picked.has(b.id) : b.mine));
      setData({
        site: {
          name: s.name, subdomain: s.subdomain, accent: s.accent, theme: s.theme, appId: s.deriv_app_id ?? '',
          template: s.template, features: s.features, tagline: s.tagline, logoUrl: s.logoUrl,
        },
        bots: (bots as (PublishedBot & { status: string })[]).filter((b) => b.status === 'published'),
        xml,
      });
    })().catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return (
    <main className="login-bg"><div className="login-card" style={{ textAlign: 'center' }}>
      <p className="error">{error}</p><Link className="btn btn-primary" to="/sites">Back to my websites</Link>
    </div></main>
  );
  if (!data) return <div className="shell-loading"><span className="spinner" /> Loading preview…</div>;
  return <TraderApp site={data.site} bots={data.bots} xmlBots={data.xml} base={`/preview/${id}`} preview />;
}
