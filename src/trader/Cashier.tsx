import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { startLogin } from '../lib/derivAuth';
import { toast } from '../components/motion';
import { DERIV_CASHIER } from './AccountSwitcher';

interface Agent {
  id: number; name: string | null; nickname: string | null; information: string | null; email: string | null;
  phone_numbers: (string | { phone_number?: string })[] | null; payment_methods: (string | { payment_method?: string })[] | null;
  min_withdrawal?: string; max_withdrawal?: string; withdrawal_minimum?: string; withdrawal_maximum?: string;
}
type Tab = 'deposit' | 'withdraw' | 'transfer';

const post = async (body: Record<string, unknown>) => {
  const r = await fetch('/api/deriv/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.error === 'cashier_expired') throw new Error('EXPIRED');
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Something went wrong. Try again.');
  return j;
};
const label = (x: string | { phone_number?: string; payment_method?: string }) => (typeof x === 'string' ? x : x.phone_number ?? x.payment_method ?? '');
const pretty = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * "Manage funds": deposit and withdraw through Deriv payment agents, on the client's own Deriv account.
 * The client grants deposits/withdrawals on Deriv's page (15 minutes), and every withdrawal needs the code Deriv emails them.
 */
export function Cashier({ onClose, preview }: { onClose: () => void; preview: boolean }) {
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const [tab, setTab] = useState<Tab>('deposit');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [result, setResult] = useState('');

  const expired = () => { setAllowed(false); setAgents(null); setError('Your cashier access ended. Continue with Deriv again.'); };

  useEffect(() => {
    if (preview) { setAllowed(false); return; }
    post({ action: 'cashier_status' }).then((j) => { setAllowed(!!j.allowed); setUntil(j.until); }).catch(() => setAllowed(false));
  }, [preview]);

  useEffect(() => {
    if (!allowed || account?.isVirtual) return;
    setAgents(null);
    post({ action: 'cashier_agents', currency }).then((j) => setAgents((j.agents ?? []) as Agent[])).catch((e: Error) => (e.message === 'EXPIRED' ? expired() : setError(e.message)));
  }, [allowed, currency, account?.isVirtual]); // eslint-disable-line react-hooks/exhaustive-deps

  const allow = () => { setBusy(true); void startLogin({ cashier: true, returnTo: '/app?cashier=1' }).catch((e: Error) => { setError(e.message); setBusy(false); }); };
  const end = () => { void post({ action: 'cashier_end' }).finally(() => { setAllowed(false); setAgents(null); toast('Cashier access ended', 'info'); }); };

  const sendCode = async () => {
    setError(''); setResult('');
    if (!agentId || !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return setError('Choose an agent and enter an amount.');
    setBusy(true);
    try { await post({ action: 'cashier_code', agent_id: agentId, amount, currency }); setCodeSent(true); toast('Code sent to your email'); }
    catch (e) { (e as Error).message === 'EXPIRED' ? expired() : setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const withdraw = async () => {
    setError('');
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from your email.');
    if (!confirm(`Withdraw ${amount} ${currency} through this payment agent?`)) return;
    setBusy(true);
    try {
      const j = await post({ action: 'cashier_withdraw', agent_id: agentId, amount, currency, verification_code: code });
      setResult(`Withdrawal ${j.status ?? 'submitted'}.${j.transaction_id ? ` Reference ${j.transaction_id}.` : ''}`);
      setCodeSent(false); setCode(''); setAmount('');
      auth.refreshBalance(); toast('Withdrawal submitted');
    } catch (e) { (e as Error).message === 'EXPIRED' ? expired() : setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const minutes = until ? Math.max(0, Math.round((until - Date.now()) / 60000)) : 0;
  const agent = agents?.find((a) => a.id === agentId);

  return (
    <div className="cx-wrap" role="dialog" aria-modal="true" aria-labelledby="cx-title" onClick={onClose}>
      <div className="cx" onClick={(e) => e.stopPropagation()}>
        <header className="cx-head">
          <h2 id="cx-title">Manage funds</h2>
          <span className="cx-acct mono">{account?.isVirtual ? 'Demo' : 'Real'} · {account?.id} · {auth.balance}</span>
          <button className="cx-x" aria-label="Close" onClick={onClose}>✕</button>
        </header>

        <div className="cx-tabs" role="tablist">
          {(['deposit', 'withdraw', 'transfer'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setError(''); setResult(''); }}>
              <span className={`cx-ic cx-ic-${t}`} aria-hidden="true" />{pretty(t)}
            </button>
          ))}
        </div>

        <div className="cx-body">
          {account?.isVirtual ? (
            <div className="cx-note"><b>You're on a demo account.</b><p>Demo money can't be deposited or withdrawn. Switch to your real account in the account menu, or reset your demo balance there.</p></div>
          ) : allowed === null ? (
            <p className="muted"><span className="spinner" /> Checking…</p>
          ) : !allowed ? (
            <div className="cx-allow">
              <h3>Allow deposits and withdrawals</h3>
              <p>For your security, signing in only allowed trading. To use the cashier, Deriv will ask you to allow deposits and withdrawals through payment agents for this site.</p>
              <ol className="cx-steps">
                <li><span>1</span>Continue to Deriv and approve.</li>
                <li><span>2</span>You come straight back here.</li>
                <li><span>3</span>Access lasts 15 minutes, then ends by itself.</li>
              </ol>
              <p className="hint">Stop any running bots first. Every withdrawal also needs a code Deriv emails to you.</p>
              <button className="cx-primary" disabled={busy || preview} onClick={allow}>{busy ? 'Opening Deriv…' : 'Continue with Deriv'}</button>
              <a className="cx-secondary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Open Deriv's cashier instead ↗</a>
            </div>
          ) : tab === 'deposit' ? (
            <div className="cx-pane">
              <p className="hint">Pick a payment agent, contact them, and send your deposit. They credit your Deriv account; the balance updates here.</p>
              {agents === null ? <div className="sk">{[1, 2, 3].map((i) => <span key={i} style={{ height: 64 }} />)}</div> : agents.length === 0 ? (
                <p className="muted">No payment agents for {currency} right now. <a href={DERIV_CASHIER} target="_blank" rel="noreferrer">Use Deriv's cashier ↗</a></p>
              ) : (
                <ul className="cx-agents">
                  {agents.map((a) => (
                    <li key={a.id} className="cx-agent">
                      <div className="cx-agent-top"><b>{a.name ?? a.nickname ?? `Agent ${a.id}`}</b><small className="mono">#{a.id}</small></div>
                      {a.payment_methods?.length ? <div className="cx-chips">{a.payment_methods.map((m) => <span key={label(m)}>{pretty(label(m))}</span>)}</div> : null}
                      <div className="cx-contact">
                        {a.phone_numbers?.map((p) => <a key={label(p)} href={`tel:${label(p)}`}>📞 {label(p)}</a>)}
                        {a.email && <a href={`mailto:${a.email}`}>✉ {a.email}</a>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : tab === 'withdraw' ? (
            <div className="cx-pane">
              <label className="field"><span className="label">Payment agent</span>
                <select className="input" value={agentId} disabled={busy || codeSent} onChange={(e) => setAgentId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{agents === null ? 'Loading agents…' : 'Choose an agent'}</option>
                  {agents?.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.nickname ?? `Agent ${a.id}`}</option>)}
                </select>
              </label>
              {agent && (agent.withdrawal_minimum || agent.min_withdrawal) && <p className="hint">Limits: {agent.withdrawal_minimum ?? agent.min_withdrawal} – {agent.withdrawal_maximum ?? agent.max_withdrawal} {currency}</p>}
              <label className="field"><span className="label">Amount</span>
                <div className="input-group"><input className="input mono" inputMode="decimal" placeholder="e.g. 25.00" value={amount} disabled={busy || codeSent} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /><span className="addon">{currency}</span></div>
              </label>
              {!codeSent ? (
                <button className="cx-primary" disabled={busy} onClick={() => void sendCode()}>{busy ? 'Sending…' : 'Email me a code'}</button>
              ) : (
                <>
                  <label className="field"><span className="label">6-digit code from your email</span>
                    <input className="input mono cx-code" inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="cx-primary" style={{ flex: 1 }} disabled={busy} onClick={() => void withdraw()}>{busy ? 'Withdrawing…' : `Withdraw ${amount} ${currency}`}</button>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); }}>Change</button>
                  </div>
                </>
              )}
              {result && <p className="cx-ok">✓ {result}</p>}
            </div>
          ) : (
            <div className="cx-pane">
              <p>Move money between your own Deriv accounts and wallets on Deriv's cashier.</p>
              <a className="cx-primary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Open transfers on Deriv ↗</a>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        <footer className="cx-foot">
          {allowed && !account?.isVirtual ? <><span className="hint">Cashier access ends in about {minutes} min.</span><button className="btn btn-ghost" onClick={end}>End now</button></> : <span className="hint">Payments are handled by Deriv. This site never holds your money.</span>}
        </footer>
      </div>
    </div>
  );
}
