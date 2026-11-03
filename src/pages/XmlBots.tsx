import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/ui';
import { useT } from '../lib/i18n';

interface XmlBot { id: string; name: string; description: string; status: 'draft' | 'published'; downloads: number; size: number; updated_at: string }

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;

export default function XmlBots() {
  const t = useT();
  const [bots, setBots] = useState<XmlBot[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const load = () => fetch('/api/xmlbots', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : { bots: [] })).then((j) => setBots(j.bots ?? [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);

  const pick = (f: File | null) => {
    setError('');
    if (!f) return setFile(null);
    if (!/\.xml$/i.test(f.name)) return setError('Choose a .xml file exported from Deriv Bot.');
    if (f.size > 400_000) return setError('File is too large (max 400 KB).');
    setFile(f);
    if (!name) setName(f.name.replace(/\.xml$/i, '').replace(/[_-]+/g, ' ').slice(0, 80));
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const xml = await file.text();
      const r = await fetch('/api/xmlbots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ name, description, xml }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error && j.error !== 'server_error' ? j.error : 'Upload failed.');
      setBots((b) => [j.bot, ...b]);
      setName(''); setDescription(''); setFile(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/xmlbots/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
    if (r.status === 402) return setError('Activate your account in Billing to publish.');
    if (r.ok) { const { bot } = await r.json(); setBots((b) => b.map((x) => (x.id === id ? bot : x))); }
  };
  const remove = async (id: string) => {
    if (!confirm('Delete this XML bot? Traders will no longer be able to download it.')) return;
    const r = await fetch(`/api/xmlbots/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok) setBots((b) => b.filter((x) => x.id !== id));
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>{t('xml.title')}</h1>
        <p className="muted">{t('xml.sub')}</p>
      </div>

      <section className="card stack" style={{ gap: 16, maxWidth: 760 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Upload a bot</h2>
        <label className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0] ?? null); }}>
          <Icon.Upload />
          <span>{file ? <b>{file.name} · {kb(file.size)}</b> : <>Drop a <b>.xml</b> file here or <u>browse</u></>}</span>
          <input ref={input} type="file" accept=".xml,application/xml,text/xml" hidden onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <div className="field">
            <label className="label" htmlFor="xname">Name</label>
            <input id="xname" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Over 3 Recovery" />
          </div>
          <div className="field">
            <label className="label" htmlFor="xdesc">Short description (optional)</label>
            <input id="xdesc" className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Market, contract, how it manages risk" />
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!file || !name.trim() || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload'}</button>
        <p className="hint">Files are checked before saving and are only ever offered as downloads, never run on our servers.</p>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Your XML bots</h2>
        {bots.length === 0 ? <p className="muted">No XML bots yet.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Name</th><th>Size</th><th>Downloads</th><th>Status</th><th /></tr></thead>
              <tbody>
                {bots.map((b) => (
                  <tr key={b.id}>
                    <td><b>{b.name}</b>{b.description && <div className="hint">{b.description}</div>}</td>
                    <td className="mono hint">{kb(b.size)}</td>
                    <td className="mono">{b.downloads}</td>
                    <td><span className={`badge ${b.status === 'published' ? 'badge-green' : 'badge-blue'}`}>{b.status}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => patch(b.id, { status: b.status === 'published' ? 'draft' : 'published' })}>
                        {b.status === 'published' ? 'Unpublish' : 'Publish to my site'}
                      </button>{' '}
                      <a className="btn btn-secondary" style={{ padding: '6px 12px' }} href={`/api/xmlbots/download?id=${b.id}`}><Icon.Download /></a>{' '}
                      <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => remove(b.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
