import { useEffect, useState } from 'react';
import BuyDomain from './BuyDomain';

interface DnsRecord { type: string; name: string; value: string; why: string }
interface DomainInfo { domain: string | null; status: 'none' | 'pending' | 'verified' | 'error'; records?: DnsRecord[]; error?: string }

/** Connect the mentor's own domain (e.g. statefx.pro): we attach it on Vercel and show the DNS records to set. */
/** Connect a domain to one site: buy a new one, or connect one the mentor already owns. */
export default function DomainStep({ siteId, onChange }: { siteId: string; onChange?: () => void }) {
  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<'buy' | 'own'>('buy');

  const handle = async (r: Response) => {
    const j = await r.json().catch(() => ({}));
    if (r.status === 204) { setInfo({ domain: null, status: 'none' }); return; }
    if (r.status === 402) return setMsg('Activate your account in Billing first.');
    if (!r.ok) return setMsg(typeof j.error === 'string' && j.error !== 'server_error' ? j.error : 'Something went wrong. Try again.');
    setInfo(j);
  };
  const check = async () => { setBusy(true); setMsg(''); await handle(await fetch(`/api/sites/${siteId}/domain`, { credentials: 'same-origin' })); setBusy(false); };
  useEffect(() => { void check(); }, [siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy(true); setMsg('');
    await handle(await fetch(`/api/sites/${siteId}/domain`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ domain: input }) }));
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm('Disconnect this domain? Your site stays on its mwasya.site address.')) return;
    setBusy(true);
    await handle(await fetch(`/api/sites/${siteId}/domain`, { method: 'DELETE', credentials: 'same-origin' }));
    setBusy(false);
  };

  const d = info?.domain;
  return (
    <div className="stack" style={{ gap: 14, padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
      <b>Your own domain</b>
      {!d ? (
        <>
          <div className="seg" role="tablist" aria-label="Domain option">
            <button role="tab" aria-selected={mode === 'buy'} className={mode === 'buy' ? 'on' : ''} onClick={() => setMode('buy')}>Buy a new domain</button>
            <button role="tab" aria-selected={mode === 'own'} className={mode === 'own' ? 'on' : ''} onClick={() => setMode('own')}>I already own one</button>
          </div>
          {mode === 'buy' ? <BuyDomain siteId={siteId} onConnected={() => { void check(); onChange?.(); }} /> : (
            <>
              <div className="row" style={{ gap: 8 }}>
                <input className="input mono" style={{ flex: '1 1 240px' }} placeholder="yourbrand.com or trade.yourbrand.com" value={input}
                  onChange={(e) => setInput(e.target.value.trim().toLowerCase())} aria-label="Your domain" />
                <button className="btn btn-primary" disabled={busy || input.length < 4} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button>
              </div>
              <span className="hint">Bought it elsewhere (Namecheap, Truehost, GoDaddy…)? Connect it here and we'll show the DNS records to add.</span>
            </>
          )}
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="mono" style={{ fontWeight: 700 }}>{d}</span>
            <span className={`badge ${info?.status === 'verified' ? 'badge-green' : 'badge-blue'}`} style={info?.status === 'error' ? { background: 'var(--danger-tint)', color: 'var(--danger)' } : undefined}>
              {info?.status === 'verified' ? 'Live' : info?.status === 'error' ? 'Problem' : 'Waiting for DNS'}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-secondary" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check again'}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={remove}>Disconnect</button>
          </div>
          {info?.status === 'verified' ? (
            <p className="hint">Your trading site is live at <a href={`https://${d}`} target="_blank" rel="noreferrer">https://{d}</a>. HTTPS is automatic.</p>
          ) : (
            <>
              <p className="hint">At your domain provider, open the DNS settings and add {info?.records && info.records.length > 1 ? 'these records' : 'this record'}. Changes can take from a few minutes up to a few hours.</p>
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th /></tr></thead>
                  <tbody>
                    {(info?.records ?? []).map((r) => (
                      <tr key={r.type + r.name + r.value}><td className="mono">{r.type}</td><td className="mono">{r.name}</td><td className="mono" style={{ overflowWrap: 'anywhere' }}>{r.value}</td><td className="hint">{r.why}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="notice" style={{ padding: '12px 14px' }}>
            <span>In your <b>Deriv app</b>, also add the redirect URI <code className="mono">https://{d}/callback</code> so your clients can log in on this domain.</span>
          </div>
        </>
      )}
      {(msg || info?.error) && <p className="error" role="alert">{msg || info?.error}</p>}
    </div>
  );
}
