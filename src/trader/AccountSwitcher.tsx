import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import type { Account } from '../lib/accounts';

const fmt = (n: number | undefined, cur = 'USD') =>
  n === undefined ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

/**
 * Deriv account switcher. Every row is the real Deriv account (ROT… real, DOT… demo) with the balance Deriv reports.
 * Whatever is selected here is exactly the account that trades.
 */
export function AccountSwitcher({ preview, onResetDemo }: { preview: boolean; onResetDemo: () => void }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'real' | 'demo'>(auth.account?.isVirtual ? 'demo' : 'real');
  const box = useRef<HTMLDivElement>(null);
  const account = auth.account;

  useEffect(() => {
    if (!open) return;
    setTab(auth.account?.isVirtual ? 'demo' : 'real');
    setLoading(true);
    void auth.reloadAccounts().finally(() => setLoading(false));
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = auth.accounts.filter((a) => (tab === 'demo' ? a.isVirtual : !a.isVirtual));
  const pick = (a: Account) => { auth.setAccountId(a.id); setOpen(false); };

  return (
    <div className="as" ref={box}>
      <button className={`as-btn ${account?.isVirtual ? 'demo' : 'real'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="as-flag">{account?.isVirtual ? 'Demo' : 'Real'}</span>
        <span className="as-main">
          <b className="mono">{auth.balance}</b>
          <small className="mono">{account?.id}</small>
        </span>
        <svg className="as-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="as-panel" role="dialog" aria-label="Deriv accounts">
          <div className="as-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'real'} className={tab === 'real' ? 'on' : ''} onClick={() => setTab('real')}>Real</button>
            <button role="tab" aria-selected={tab === 'demo'} className={tab === 'demo' ? 'on' : ''} onClick={() => setTab('demo')}>Demo</button>
          </div>
          <ul className="as-list">
            {list.length === 0 && <li className="as-empty">{tab === 'real' ? 'No real account yet.' : 'No demo account.'}{tab === 'real' && <a href="https://app.deriv.com" target="_blank" rel="noreferrer"> Open one on Deriv ↗</a>}</li>}
            {list.map((a) => {
              const on = a.id === account?.id;
              return (
                <li key={a.id}>
                  <button className={`as-row ${on ? 'on' : ''}`} disabled={a.active === false} onClick={() => pick(a)}>
                    <span className={`as-cur ${a.isVirtual ? 'demo' : 'real'}`}>{(a.currency ?? 'USD').slice(0, 3)}</span>
                    <span className="as-row-main">
                      <b>{a.isVirtual ? 'Demo' : 'Real'} {a.currency ?? ''}</b>
                      <small className="mono">{a.id}{a.active === false ? ' · inactive' : ''}</small>
                    </span>
                    <span className="as-bal mono">{loading && a.balance === undefined ? '…' : on ? auth.balance : fmt(a.balance, a.currency)}</span>
                    {on && <span className="as-tick" aria-label="Selected">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="as-foot">
            {tab === 'demo' && account?.isVirtual && !preview && <button className="btn btn-secondary" onClick={() => { setOpen(false); onResetDemo(); }}>Reset demo balance</button>}
            {tab === 'real' && <a className="btn btn-secondary" href="https://app.deriv.com/cashier/deposit" target="_blank" rel="noreferrer">Deposit ↗</a>}
            <span className="hint">{loading ? 'Updating from Deriv…' : 'Balances from Deriv'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
