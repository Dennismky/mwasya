import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/ui';
import { useAuth } from '../lib/auth';
import { listStrategies } from '../lib/autoTrade';
import { useBotRunner } from '../lib/useBotRunner';
import { RunCard } from '../components/RunCard';
import { startLogin } from '../lib/derivAuth';

import {
  CONTRACT_GROUPS, LIMITS, MARKETS, TEMPLATES, contractLabel, defaultSpec, isValid, marketLabel, validateSpec,
  type BotSpec, type Check, type DerivStrategy, type ForgeStrategy,
} from '../shared/botSpec';

interface SavedBot { id: string; name: string; spec: BotSpec; risk: string; status: 'draft' | 'published'; updated_at: string }


const DIGIT_BARRIER = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];
const TICK_ONLY = [...DIGIT_BARRIER, 'DIGITEVEN', 'DIGITODD', 'ASIANU', 'ASIAND'];

type Status = 'loading' | 'relogin' | 'ready' | 'error';

export default function Forge() {
  const auth = useAuth();
  const account = auth.account;
  const accountId = account?.id ?? '';
  const [status, setStatus] = useState<Status>(auth.operator ? 'loading' : 'relogin');
  const [error, setError] = useState('');
  const [strategies, setStrategies] = useState<DerivStrategy[] | undefined>();
  const [spec, setSpec] = useState<BotSpec>(defaultSpec);
  const [bots, setBots] = useState<SavedBot[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverChecks, setServerChecks] = useState<Check[] | null>(null);





  const runner = useBotRunner(accountId || undefined, auth.expire);
  const { runs, launch, conn, connError } = runner;

  const checks = useMemo(() => serverChecks ?? validateSpec(spec, strategies), [spec, strategies, serverChecks]);
  const valid = isValid(checks);
  const editingBot = bots.find((b) => b.id === editingId);

  const update = (fn: (s: BotSpec) => BotSpec) => { setServerChecks(null); setSpec((s) => fn(structuredClone(s))); };

  // Saved bots + Deriv strategy rules (session/accounts come from <AppShell />)
  useEffect(() => {
    listStrategies().then(setStrategies).catch(() => undefined);
    if (!auth.operator) return;
    (async () => {
      const r = await fetch('/api/bots', { credentials: 'same-origin' });
      if (r.status === 401) return setStatus('relogin');
      if (!r.ok) throw new Error('Could not load your bots. Is the database set up?');
      setBots(((await r.json()) as { bots: SavedBot[] }).bots);
      setStatus('ready');
    })().catch((e: Error) => { setError(e.message || 'Something went wrong.'); setStatus('error'); });
  }, [auth.operator]);

  // Keep the bot currency in line with the selected account
  useEffect(() => {
    if (account?.currency && account.currency !== spec.contract.currency) update((s) => { s.contract.currency = account.currency!; return s; });
  }, [account?.currency]); // eslint-disable-line react-hooks/exhaustive-deps


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

  function run() {
    if (!account) return;
    if (!account.isVirtual && !confirm(`Run "${spec.name}" on your REAL account ${account.id}?\n\nYou can lose up to ${spec.params.stop_loss} ${spec.contract.currency}. Losses are not guaranteed to stop exactly at that amount.`)) return;
    void runner.start(spec);
  }

  const controlRun = (action: 'pause' | 'resume' | 'stop', runId: string) =>
    runner.control(action, runId).then((err) => { if (err) setError(err); });

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
    <div className="stack" style={{ gap: 24 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Bot Forge</h1>
        <p className="muted">Build a bot, check its safety limits, test it on demo, then publish it to your site.</p>
      </div>

      {status === 'relogin' && (
        <div className="notice">
          <div className="stack" style={{ gap: 4 }}>
            <b>Log in again to save bots</b>
            <span className="hint">We need to link your Deriv login to your Mwasya workspace. You can still build and test-run bots.</span>
          </div>
          <button className="btn btn-primary" onClick={() => startLogin({ returnTo: '/forge' }).catch((e: Error) => setError(e.message))}>Log in again</button>
        </div>
      )}
      {status === 'error' && (
        <div className="notice">
          <div className="stack" style={{ gap: 4 }}>
            <b>Saving is unavailable right now</b>
            <span className="hint">We couldn't load your saved bots (is the database set up?). You can still build and test-run bots.</span>
          </div>
        </div>
      )}
      {status === 'loading' && <p className="muted" aria-live="polite">Loading your bots…</p>}

          <>
            <div className="forge-grid">
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
              <aside className="stack forge-aside" style={{ gap: 16 }}>
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
                  {account && !account.isVirtual && <p className="error">This is a real-money account.</p>}
                  <button className="btn btn-primary" disabled={!valid || !strategies || conn !== 'ready' || launch.phase === 'starting'} onClick={run}>
                    <Icon.Chip /> {launch.phase === 'starting' ? 'Starting…' : `Run on ${account?.isVirtual ? 'demo' : 'real'}`}
                  </button>
                  <div aria-live="polite" className="stack" style={{ gap: 8 }}>
                    {!valid && <span className="hint">Fix the issues in Safety checks to enable this.</span>}
                    {valid && !strategies && <span className="hint"><span className="spinner" />Loading Deriv's strategy rules…</span>}
                    {valid && strategies && conn === 'connecting' && <span className="hint"><span className="spinner" />Connecting to your Deriv account…</span>}
                    {conn === 'error' && <p className="error" role="alert">Can't reach your Deriv account: {connError}</p>}
                    {launch.phase === 'starting' && <span className="hint"><span className="spinner" />Sending the bot to Deriv…</span>}
                    {launch.phase === 'error' && <p className="error" role="alert">{launch.message}</p>}
                    {launch.phase === 'running' && runs[launch.runId] && (
                      <RunCard run={runs[launch.runId]} currency={account?.currency ?? ''} compact
                        onPause={() => controlRun('pause', launch.runId)} onResume={() => controlRun('resume', launch.runId)} onStop={() => controlRun('stop', launch.runId)} />
                    )}
                  </div>
                  {error && <p className="error" role="alert">{error}</p>}
                </section>
              </aside>
            </div>

            {/* Runs */}
            {runList.length > 0 && (
              <section className="card stack" style={{ gap: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Runs on this account</h2>
                {runList.map((r) => <RunCard key={r.run_id} run={r} currency={account?.currency ?? ''}
                  onPause={() => controlRun('pause', r.run_id)} onResume={() => controlRun('resume', r.run_id)} onStop={() => controlRun('stop', r.run_id)} />)}
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
    </div>
  );
}

