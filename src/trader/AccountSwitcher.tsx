import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/auth';
import type { Account } from '../lib/accounts';

/** Deriv's own cashier (deposit and withdrawal happen there, never on this site). */
// EDIT HERE: link used when a client opens Deriv's own cashier.
export const DERIV_CASHIER = 'https://home.deriv.com/dashboard/cashier';

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
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 72, right: 16 });
  const account = auth.account;

  useEffect(() => {
    if (!open) return;
    setTab(auth.account?.isVirtual ? 'demo' : 'real');
    setLoading(true);
    void auth.reloadAccounts().finally(() => setLoading(false));
    // Card position: just under the account button (phones: centred by CSS).
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = auth.accounts.filter((a) => (tab === 'demo' ? a.isVirtual : !a.isVirtual));
  const pick = (a: Account) => { auth.setAccountId(a.id); setOpen(false); };

  return (
    <div className="as" ref={box}>
      <button ref={btn} className={`as-btn ${account?.isVirtual ? "demo" : "real"}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="as-flag">{account?.isVirtual ? 'Demo' : 'Real'}</span>
        <span className="as-main">
          <b className="mono">{auth.balance}</b>
          <small className="mono">{account?.id}</small>
        </span>
        <svg className="as-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && createPortal(
        <div className="as-overlay" onMouseDown={() => setOpen(false)}>
        <div className="as-panel as-float" role="dialog" aria-label="Deriv accounts" style={{ top: pos.top, right: pos.right }} onMouseDown={(e) => e.stopPropagation()}>
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
            {tab === 'real' && <span className="row" style={{ gap: 6 }}><a className="btn btn-primary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Deposit ↗</a><a className="btn btn-secondary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Withdraw ↗</a></span>}
            <span className="hint">{loading ? 'Updating from Deriv…' : 'Balances from Deriv'}</span>
          </div>
        </div>
        </div>,
        // Inside the client site root so its colours and dark mode apply.
        (box.current?.closest('.tp') as HTMLElement | null) ?? document.body,
      )}
    </div>
  );
}
