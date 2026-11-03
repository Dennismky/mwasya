import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand, Icon } from '../components/ui';
import { fetchAccounts, type Account } from '../lib/accounts';
import { listRuns, listStrategies, pauseRun, resumeRun, runPnL, startRun, stopRun, watchRun, type AutoRun } from '../lib/autoTrade';
import { getSession, startLogin } from '../lib/derivAuth';
import { accountSocket, type DerivSocket } from '../lib/derivWs';
import {
  CONTRACT_GROUPS, LIMITS, TEMPLATES, contractLabel, defaultSpec, isValid, validateSpec,
  type BotSpec, type Check, type DerivStrategy, type ForgeStrategy,
} from '../shared/botSpec';

interface SavedBot { id: string; name: string; spec: BotSpec; risk: string; status: 'draft' | 'published'; updated_at: string }

const MARKETS = [
  ['1HZ10V', 'Volatility 10 (1s)'], ['1HZ25V', 'Volatility 25 (1s)'], ['1HZ50V', 'Volatility 50 (1s)'],
  ['1HZ75V', 'Volatility 75 (1s)'], ['1HZ100V', 'Volatility 100 (1s)'],
  ['R_10', 'Volatility 10'], ['R_25', 'Volatility 25'], ['R_50', 'Volatility 50'], ['R_75', 'Volatility 75'], ['R_100', 'Volatility 100'],
] as const;
const marketLabel = (s: string) => MARKETS.find(([id]) => id === s)?.[1] ?? s;

const DIGIT_BARRIER = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];
const TICK_ONLY = [...DIGIT_BARRIER, 'DIGITEVEN', 'DIGITODD', 'ASIANU', 'ASIAND'];

type Status = 'checking' | 'signed-out' | 'relogin' | 'ready' | 'error';

export default function Forge() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [strategies, setStrategies] = useState<DerivStrategy[] | undefined>();
  const [spec, setSpec] = useState<BotSpec>(defaultSpec);
  const [bots, setBots] = useState<SavedBot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverChecks, setServerChecks] = useState<Check[] | null>(null);
  const [runs, setRuns] = useState<Record<string, AutoRun>>({});
  const [busy, setBusy] = useState(false);
  const ws = useRef<DerivSocket | null>(null);
  const unsubs = useRef<Map<string, () => void>>(new Map());

  const account = accounts.find((a) => a.id === accountId);
  const checks = useMemo(() => serverChecks ?? validateSpec(spec, strategies), [spec, strategies, serverChecks]);
  const valid = isValid(checks);
  const editingBot = bots.find((b) => b.id === editingId);

  const update = (fn: (s: BotSpec) => BotSpec) => { setServerChecks(null); setSpec((s) => fn(structuredClone(s))); };

  // Session, accounts, saved bots, Deriv strategy rules
  useEffect(() => {
    listStrategies().then(setStrategies).catch(() => undefined);
    (async () => {
      const s = await getSession();
      if (!s.loggedIn) return setStatus('signed-out');
      if (!s.operator) return setStatus('relogin');
      const list = await fetchAccounts();
      if (list === 'expired') return setStatus('signed-out');
      setAccounts(list);
      setAccountId((list.find((a) => a.isVirtual) ?? list[0])?.id ?? '');
      const r = await fetch('/api/bots', { credentials: 'same-origin' });
      if (r.status === 401) return setStatus('relogin');
      if (r.ok) setBots(((await r.json()) as { bots: SavedBot[] }).bots);
      setStatus('ready');
    })().catch((e: Error) => { setError(e.message || 'Something went wrong.'); setStatus('error'); });
  }, []);

  // Keep the bot currency in line with the selected account
  useEffect(() => {
    if (account?.currency && account.currency !== spec.contract.currency) update((s) => { s.contract.currency = account.currency!; return s; });
  }, [account?.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRunUpdate = useCallback((run: AutoRun) => setRuns((r) => ({ ...r, [run.run_id]: run })), []);

  // Private socket per account → re-attach to runs that are still going
  useEffect(() => {
    if (!accountId) return;
    const sock = accountSocket(accountId);
    ws.current = sock;
    setRuns({});
    const subs = unsubs.current;
    listRuns(sock)
      .then((list) => {
        const map: Record<string, AutoRun> = {};
        for (const run of list) {
          map[run.run_id] = run;
          if (run.status !== 'stopped') {
            watchRun(sock, run.run_id, onRunUpdate, setError).then((u) => subs.set(run.run_id, u)).catch(() => undefined);
          }
        }
        setRuns(map);
      })
      .catch((e: Error) => setError(e.message === 'SESSION_EXPIRED' ? 'Your Deriv session has ended. Please log in again.' : e.message));
    return () => { subs.forEach((u) => u()); subs.clear(); sock.close(); ws.current = null; };
  }, [accountId, onRunUpdate]);

  async function save(nextStatus?: 'draft' | 'published') {
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = { spec };
      if (nextStatus) body.status = nextStatus;
      const r = await fetch(editingId ? `/api/bots/${editingId}` : '/api/bots', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      if (r.status === 422) return setServerChecks(json.checks);
      if (r.status === 401) return setStatus('relogin');
      if (!r.ok) throw new Error('Could not save the bot.');
      let bot = json.bot as SavedBot;
      if (!editingId && nextStatus === 'published') {
        // created as draft → publish in a second step
        const p = await fetch(`/api/bots/${bot.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ status: 'published' }) });
        if (p.ok) bot = (await p.json()).bot;
      }
      setEditingId(bot.id);
      setBots((list) => [bot, ...list.filter((b) => b.id !== bot.id)]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    if (!confirm('Delete this bot? Traders will no longer see it.')) return;
    const r = await fetch(`/api/bots/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (r.ok || r.status === 404) {
      setBots((l) => l.filter((b) => b.id !== id));
      if (editingId === id) { setEditingId(null); setSpec(defaultSpec()); }
    }
  }

  async function run() {
    if (!ws.current || !account) return;
    if (!account.isVirtual && !confirm(`Run "${spec.name}" on your REAL account ${account.id}?\n\nYou can lose up to ${spec.params.stop_loss} ${spec.contract.currency}. Losses are not guaranteed to stop exactly at that amount.`)) return;
    setBusy(true); setError('');
    let first = true;
    try {
      const u = await startRun(ws.current, spec, (r) => {
        onRunUpdate(r);
        if (first) { first = false; unsubs.current.set(r.run_id, u); }
      }, (m) => { setError(m); setBusy(false); });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function controlRun(fn: typeof pauseRun, runId: string) {
    if (!ws.current) return;
    try { onRunUpdate(await fn(ws.current, runId)); } catch (e) { setError((e as Error).message); }
  }

  function setContractType(type: string) {
    update((s) => {
      const c = s.contract;
      c.contract_type = type;
      delete c.barrier; delete c.growth_rate;
      if (DIGIT_BARRIER.includes(type)) c.barrier = type === 'DIGITUNDER' ? '6' : type === 'DIGITOVER' ? '3' : '5';
      if (type === 'ACCU') { delete c.duration; delete c.duration_unit; c.growth_rate = 0.01; }
      else if (TICK_ONLY.includes(type)) { c.duration_unit = 't'; c.duration = type.startsWith('ASIAN') ? 5 : 1; }
      else { c.duration_unit = c.duration_unit ?? 't'; c.duration = c.duration ?? 5; }
      return s;
    });
  }

  function setStrategy(st: ForgeStrategy) {
    update((s) => {
      s.strategy = st;
      const p = s.params;
      if (st === 'fixed') { delete p.max_stake; delete p.multiplier; delete p.unit; }
      if (st === 'martingale') { delete p.unit; p.multiplier = p.multiplier ?? 2; p.max_stake = p.max_stake ?? String(Math.min(Number(p.stop_loss) || 0, (Number(p.initial_stake) || 1) * 16)); }
      if (st === 'dalembert') { delete p.multiplier; p.unit = p.unit ?? p.initial_stake; p.max_stake = p.max_stake ?? String(Math.min(Number(p.stop_loss) || 0, (Number(p.initial_stake) || 1) * 5)); }
      return s;
    });
  }

  const fieldErr = (f: string) => checks.find((c) => c.severity === 'error' && c.field === f)?.text;
  const money = (key: 'initial_stake' | 'take_profit' | 'stop_loss' | 'max_stake' | 'unit', label: string, hint?: string) => (
    <div className="field">
      <label className="label" htmlFor={key}>{label}</label>
      <div className="input-group">
        <input id={key} className="input" inputMode="decimal" value={spec.params[key] ?? ''}
          onChange={(e) => update((s) => { s.params[key] = e.target.value.trim(); return s; })} aria-invalid={Boolean(fieldErr(key))} />
        <span className="addon">{spec.contract.currency}</span>
      </div>
      {fieldErr(key) ? <span className="error">{fieldErr(key)}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );

  const ctype = spec.contract.contract_type;
  const supported = strategies?.find((s) => s.strategy_id === (spec.strategy === 'fixed' ? 'martingale' : spec.strategy))?.supported_contract_types;
  const runList = Object.values(runs).sort((a, b) => b.start_time - a.start_time);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-alt)' }}>
      <header className="nav">
        <div className="container nav-inner">
          <Brand />
          <span className="badge badge-blue">Bot Forge</span>
          <span style={{ flex: 1 }} />
          {status === 'ready' && (
            <select className="input" style={{ width: 'auto' }} aria-label="Trading account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          )}
          <Link className="btn btn-secondary" to="/app">Dashboard</Link>
        </div>
      </header>

      <main className="container stack" style={{ padding: '32px 24px', gap: 24 }}>
        {status === 'checking' && <p className="muted" aria-live="polite">Loading…</p>}

        {(status === 'signed-out' || status === 'relogin') && (
          <section className="card stack" style={{ maxWidth: 520, gap: 16 }}>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{status === 'relogin' ? 'Please log in again' : 'Log in to use Bot Forge'}</h1>
            <p className="muted">{status === 'relogin'
              ? 'We need to link your Deriv login to your Mwasya workspace before you can save bots.'
              : 'Bots run on your own Deriv account. We only ask for trade access and can never withdraw.'}</p>
            <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} onClick={() => startLogin({ returnTo: '/forge' }).catch((e: Error) => setError(e.message))}>Log in with Deriv</button>
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        )}

        {status === 'error' && <p className="error" role="alert">{error}</p>}

        {status === 'ready' && (
          <>
            <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(0, 3fr) minmax(300px, 2fr)', alignItems: 'start' }}>
              {/* Builder */}
              <section className="card stack" style={{ gap: 18 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <h1 style={{ fontSize: 24, fontWeight: 700 }}>{editingBot ? 'Edit bot' : 'New bot'}</h1>
                  {editingBot && <button className="btn btn-secondary" onClick={() => { setEditingId(null); setSpec(defaultSpec()); setServerChecks(null); }}>+ New bot</button>}
                </div>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="label">Start from a template</span>
                  <div className="row" style={{ gap: 8 }}>
                    {TEMPLATES.map((t) => (
                      <button key={t.label} className="btn btn-secondary" style={{ padding: '8px 14px' }}
                        onClick={() => { setServerChecks(null); setSpec({ ...structuredClone(t.spec), contract: { ...t.spec.contract, currency: account?.currency ?? 'USD' } }); }}>{t.label}</button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label className="label" htmlFor="name">Bot name</label>
                  <input id="name" className="input" maxLength={80} value={spec.name} onChange={(e) => update((s) => { s.name = e.target.value; return s; })} />
                  {fieldErr('name') && <span className="error">{fieldErr('name')}</span>}
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                  <div className="field">
                    <label className="label" htmlFor="market">Market</label>
                    <select id="market" className="input" value={spec.contract.underlying_symbol} onChange={(e) => update((s) => { s.contract.underlying_symbol = e.target.value; return s; })}>
                      {MARKETS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="ctype">Contract</label>
                    <select id="ctype" className="input" value={ctype} onChange={(e) => setContractType(e.target.value)}>
                      {CONTRACT_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.types.map((t) => <option key={t.id} value={t.id} disabled={supported ? !supported.includes(t.id) : false}>{t.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {fieldErr('contract_type') && <span className="error">{fieldErr('contract_type')}</span>}
                  </div>

                  {DIGIT_BARRIER.includes(ctype) && (
                    <div className="field">
                      <label className="label" htmlFor="barrier">Digit</label>
                      <select id="barrier" className="input" value={spec.contract.barrier} onChange={(e) => update((s) => { s.contract.barrier = e.target.value; return s; })}>
                        {Array.from({ length: 10 }, (_, d) => String(d)).map((d) => <option key={d}>{d}</option>)}
                      </select>
                      {fieldErr('barrier') && <span className="error">{fieldErr('barrier')}</span>}
                    </div>
                  )}

                  {ctype === 'ACCU' ? (
                    <div className="field">
                      <label className="label" htmlFor="growth">Growth rate</label>
                      <select id="growth" className="input" value={spec.contract.growth_rate} onChange={(e) => update((s) => { s.contract.growth_rate = Number(e.target.value); return s; })}>
                        {[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => <option key={g} value={g}>{g * 100}%</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="field">
                      <label className="label" htmlFor="duration">Duration</label>
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <input id="duration" className="input" type="number" min={1} value={spec.contract.duration ?? ''}
                          onChange={(e) => update((s) => { s.contract.duration = Math.floor(Number(e.target.value)); return s; })} />
                        <select className="input" aria-label="Duration unit" style={{ width: 120 }} value={spec.contract.duration_unit}
                          disabled={TICK_ONLY.includes(ctype)} onChange={(e) => update((s) => { s.contract.duration_unit = e.target.value as 't'; return s; })}>
                          <option value="t">ticks</option><option value="s">seconds</option><option value="m">minutes</option>
                        </select>
                      </div>
                      {fieldErr('duration') && <span className="error">{fieldErr('duration')}</span>}
                    </div>
                  )}
                </div>

                <div className="field">
                  <span className="label">After each trade</span>
                  <div className="row" style={{ gap: 8 }}>
                    {([['fixed', 'Same stake', 'Low risk'], ['dalembert', "D'Alembert", 'Medium risk'], ['martingale', 'Martingale', 'High risk']] as const).map(([id, label, risk]) => (
                      <button key={id} className={`btn ${spec.strategy === id ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={spec.strategy === id} onClick={() => setStrategy(id)}>
                        {label} <span style={{ fontWeight: 500, opacity: 0.8, fontSize: 13 }}>· {risk}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                  {money('initial_stake', 'Starting stake')}
                  {money('take_profit', 'Take profit', 'Stop once profit reaches this')}
                  {money('stop_loss', 'Stop loss', `Stop once losses reach this (max ${LIMITS.maxStopLoss})`)}
                  {spec.strategy !== 'fixed' && money('max_stake', 'Max stake', 'The stake never goes above this')}
                  {spec.strategy === 'dalembert' && money('unit', 'Step', 'Added after a loss, removed after a win')}
                  {spec.strategy === 'martingale' && (
                    <div className="field">
                      <label className="label" htmlFor="mult">Multiply stake after a loss by</label>
                      <input id="mult" className="input" type="number" step="0.1" min={1.1} max={LIMITS.maxMultiplier} value={spec.params.multiplier ?? 2}
                        onChange={(e) => update((s) => { s.params.multiplier = Number(e.target.value); return s; })} />
                      {fieldErr('multiplier') && <span className="error">{fieldErr('multiplier')}</span>}
                    </div>
                  )}
                  <div className="field">
                    <label className="label" htmlFor="maxc">Max trades</label>
                    <input id="maxc" className="input" type="number" min={1} max={LIMITS.maxContracts} value={spec.params.max_contracts}
                      onChange={(e) => update((s) => { s.params.max_contracts = Math.floor(Number(e.target.value)); return s; })} />
                    {fieldErr('max_contracts') && <span className="error">{fieldErr('max_contracts')}</span>}
                  </div>
                </div>
              </section>

              {/* Summary + safety + actions */}
              <aside className="stack" style={{ gap: 16, position: 'sticky', top: 16 }}>
                <section className="card stack" style={{ gap: 14 }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 600 }}>{contractLabel(ctype)}{spec.contract.barrier ? ` ${spec.contract.barrier}` : ''} · {marketLabel(spec.contract.underlying_symbol)}</h2>
                    {editingBot && <span className={`badge ${editingBot.status === 'published' ? 'badge-green' : 'badge-blue'}`}>{editingBot.status.toUpperCase()}</span>}
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>Safety checks</h3>
                  <ul className="stack" style={{ gap: 8, listStyle: 'none', padding: 0, margin: 0 }} aria-live="polite">
                    {checks.map((c, i) => (
                      <li key={i} className="row" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start', fontSize: 14 }}>
                        <span aria-hidden="true" style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12,
                          background: c.severity === 'ok' ? 'var(--success-tint)' : c.severity === 'warning' ? '#FFF4DB' : 'var(--danger-tint)',
                          color: c.severity === 'ok' ? 'var(--success)' : c.severity === 'warning' ? '#8A5A00' : 'var(--danger)' }}>
                          {c.severity === 'ok' ? '✓' : '!'}
                        </span>
                        <span>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                  {!strategies && <span className="hint">Loading Deriv's strategy rules…</span>}
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn-secondary" disabled={!valid || saving} onClick={() => save()}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save draft'}</button>
                    {editingBot?.status === 'published'
                      ? <button className="btn btn-secondary" disabled={saving} onClick={() => save('draft')}>Unpublish</button>
                      : <button className="btn btn-primary" disabled={!valid || saving} onClick={() => save('published')}>Publish to my site</button>}
                  </div>
                </section>

                <section className="card stack" style={{ gap: 12 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Test run</h2>
                  <p className="hint">Runs on {account?.label ?? 'your account'}. Deriv places the trades and stops at your limits.</p>
                  {!account?.isVirtual && <p className="error">This is a real-money account.</p>}
                  <button className="btn btn-primary" disabled={!valid || busy || !strategies} onClick={run}>
                    <Icon.Chip /> {busy ? 'Starting…' : `Run on ${account?.isVirtual ? 'demo' : 'real'}`}
                  </button>
                  {error && <p className="error" role="alert">{error}</p>}
                </section>
              </aside>
            </div>

            {/* Runs */}
            {runList.length > 0 && (
              <section className="card stack" style={{ gap: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Runs on this account</h2>
                {runList.map((r) => <RunCard key={r.run_id} run={r} currency={account?.currency ?? ''}
                  onPause={() => controlRun(pauseRun, r.run_id)} onResume={() => controlRun(resumeRun, r.run_id)} onStop={() => controlRun(stopRun, r.run_id)} />)}
              </section>
            )}

            {/* Saved bots */}
            <section className="card stack" style={{ gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>My bots</h2>
              {bots.length === 0 ? <p className="muted">No bots yet. Build one above and save it.</p> : (
                <table className="table">
                  <thead><tr><th>Name</th><th>Risk</th><th>Status</th><th>Updated</th><th /></tr></thead>
                  <tbody>
                    {bots.map((b) => (
                      <tr key={b.id} style={{ background: b.id === editingId ? 'var(--primary-tint)' : undefined }}>
                        <td><b>{b.name}</b></td>
                        <td>{b.risk}</td>
                        <td><span className={`badge ${b.status === 'published' ? 'badge-green' : 'badge-blue'}`}>{b.status}</span></td>
                        <td className="hint">{new Date(b.updated_at).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => { setEditingId(b.id); setServerChecks(null); setSpec(structuredClone(b.spec)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>{' '}
                          <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={() => archive(b.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RunCard({ run, currency, onPause, onResume, onStop }: { run: AutoRun; currency: string; onPause: () => void; onResume: () => void; onStop: () => void }) {
  const pnl = runPnL(run);
  const contracts = run.contracts ?? [];
  const won = contracts.filter((c) => c.contract_status === 'won').length;
  const lost = contracts.filter((c) => c.contract_status === 'lost').length;
  const t = run.contract_template as { contract_type?: string; underlying_symbol?: string; barrier?: string };
  return (
    <article className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <b>{contractLabel(t.contract_type ?? '')}{t.barrier ? ` ${t.barrier}` : ''} · {marketLabel(t.underlying_symbol ?? '')}</b>
        <span className={`badge ${run.status === 'running' ? 'badge-green' : 'badge-blue'}`}>{run.status}</span>
        <span className="hint mono">{run.run_id}</span>
        <span style={{ flex: 1 }} />
        <b className="mono" style={{ color: pnl > 0 ? 'var(--success)' : pnl < 0 ? 'var(--danger)' : undefined }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} {currency}</b>
        {run.status === 'running' && <button className="btn btn-secondary" onClick={onPause}>Pause</button>}
        {run.status === 'paused' && <button className="btn btn-secondary" onClick={onResume}>Resume</button>}
        {run.status !== 'stopped' && <button className="btn btn-secondary" onClick={onStop}>Stop</button>}
      </div>
      <span className="hint">
        {contracts.length} trades · {won} won · {lost} lost · staked {(run.total_stake ?? 0).toFixed(2)}
        {run.stop_reason && ` · stopped: ${run.stop_reason.replace('_', ' ')}${run.stop_reason_code ? ` (${run.stop_reason_code})` : ''}`}
      </span>
    </article>
  );
}
