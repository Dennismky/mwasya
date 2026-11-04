import { useEffect, useState } from 'react';
import { startLogin } from '../lib/derivAuth';
import { useT } from '../lib/i18n';

interface Row { app_id?: string | number; app_name?: string; app_markup_usd?: number; volume_usd?: number; contract_count?: number; client_count?: number; [k: string]: unknown }
interface Stats { total_app_markup_usd: number; total_volume_usd: number; total_payout_usd: number; total_contract_count: number; total_client_count: number; breakdown: Row[] }

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 864e5));
const usd = (n: number | undefined) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PRESETS: { label: string; from: () => string }[] = [
  { label: 'Today', from: () => daysAgo(0) },
  { label: '7 days', from: () => daysAgo(6) },
  { label: '30 days', from: () => daysAgo(29) },
  { label: 'This month', from: () => { const d = new Date(); return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))); } },
  { label: '90 days', from: () => daysAgo(89) },
];

export default function Commissions() {
  const t = useT();
  const [preset, setPreset] = useState(2);
  const [stats, setStats] = useState<Stats | null>(null);
  const [needsScope, setNeedsScope] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    const from = PRESETS[preset].from(), to = ymd(new Date());
    fetch(`/api/commissions?from=${from}&to=${to}`, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!live) return;
        if (r.status === 429) throw new Error('Too many requests. Wait a minute.');
        if (!r.ok) throw new Error('Could not load earnings from Deriv.');
        const j = await r.json();
        if (j.needsScope) { setNeedsScope(true); setStats(null); } else { setNeedsScope(false); setStats(j.data); }
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [preset]);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('com.title')}</h1>
          <p className="muted">{t('com.sub')}</p>
        </div>
        <div className="row" style={{ gap: 6 }} role="group" aria-label="Date range">
          {PRESETS.map((p, i) => (
            <button key={p.label} className={`btn ${i === preset ? 'btn-primary' : 'btn-secondary'}`} style={{ padding: '8px 12px' }} aria-pressed={i === preset} onClick={() => setPreset(i)}>{p.label}</button>
          ))}
        </div>
      </div>

      {needsScope ? (
        <section className="card stack" style={{ gap: 14, maxWidth: 640 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Connect your earnings</h2>
          <p className="muted">To show your markup, Deriv needs your permission to read your app statistics. This is read-only: it can't trade, withdraw or change anything.</p>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => startLogin({ returnTo: '/commissions', withEarnings: true })}>Connect earnings with Deriv</button>
          <p className="hint">Earnings come from the Deriv apps you own, including your trader site's app. They're paid by Deriv directly to your Deriv account.</p>
        </section>
      ) : (
        <>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
            <Tile label="MARKUP EARNED" value={usd(stats?.total_app_markup_usd)} strong />
            <Tile label="TRADING VOLUME" value={usd(stats?.total_volume_usd)} />
            <Tile label="CONTRACTS" value={(stats?.total_contract_count ?? 0).toLocaleString()} />
            <Tile label="TRADERS" value={(stats?.total_client_count ?? 0).toLocaleString()} />
          </div>
          <section className="card stack" style={{ gap: 12 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>By app</h2>
            {!stats?.breakdown?.length ? <p className="muted">{loading ? t('common.loading') : 'No trades in this period yet.'}</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>App</th><th>Markup</th><th>Volume</th><th>Contracts</th><th>Traders</th></tr></thead>
                  <tbody>
                    {stats.breakdown.map((r, i) => (
                      <tr key={String(r.app_id ?? i)}>
                        <td><b>{String(r.app_name ?? r.app_id ?? '—')}</b>{r.app_name && r.app_id ? <div className="hint mono">{String(r.app_id)}</div> : null}</td>
                        <td className="mono">{usd(Number(r.app_markup_usd ?? r.total_app_markup_usd ?? 0))}</td>
                        <td className="mono">{usd(Number(r.volume_usd ?? r.total_volume_usd ?? 0))}</td>
                        <td className="mono">{Number(r.contract_count ?? r.total_contract_count ?? 0).toLocaleString()}</td>
                        <td className="mono">{Number(r.client_count ?? r.total_client_count ?? 0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <section className="card stack" style={{ gap: 6, padding: 20 }}>
      <span className="hint" style={{ fontWeight: 600 }}>{label}</span>
      <b className="mono" style={{ fontSize: 26, color: strong ? 'var(--success)' : undefined }}>{value}</b>
    </section>
  );
}
