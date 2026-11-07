import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../lib/auth';
import { fitScale } from '../lib/fit';
import type { Account } from '../lib/accounts';
import { parseAmount, setDisplayCur, showMoney, useDisplayCurrency } from '../lib/fx';

/** Deriv's own cashier (deposit and withdrawal happen there, never on this site). */
// EDIT HERE: link used when a client opens Deriv's own cashier.
export const DERIV_CASHIER = 'https://home.deriv.com/dashboard/cashier';


/** Round currency badge: a US flag for USD accounts (drawn, so it shows on every device), the code otherwise. */
// EDIT HERE: add more flags (e.g. EUR, GBP) as new branches if clients get other currencies.
function CurrencyIcon({ currency, size = 38 }: { currency?: string; size?: number }) {
  if ((currency ?? 'USD').toUpperCase() !== 'USD') return <span className="as-cur" style={{ width: size, height: size }}>{(currency ?? '').slice(0, 3)}</span>;
  const stripes = Array.from({ length: 7 }, (_, i) => <rect key={i} x="0" y={i * 2 * (20 / 13)} width="38" height={20 / 13} fill="#B22234" />);
  return (
    <svg className="as-us" width={size} height={size} viewBox="0 0 20 20" role="img" aria-label="USD">
      <defs><clipPath id="as-us-c"><circle cx="10" cy="10" r="10" /></clipPath></defs>
      <g clipPath="url(#as-us-c)">
        <rect width="38" height="20" fill="#fff" />
        {stripes}
        <rect width="10" height={20 * 7 / 13} fill="#3C3B6E" />
        {[2, 5, 8].map((x) => [2, 5, 8].map((y) => <circle key={`${x}${y}`} cx={x} cy={y * 0.95} r=".7" fill="#fff" />))}
      </g>
      <circle cx="10" cy="10" r="9.6" fill="none" stroke="rgba(0,0,0,.15)" strokeWidth=".8" />
    </svg>
  );
}

/** Small round Kenya flag for the KSh option (drawn, so it shows on every device). */
function KenyaFlag({ size = 16 }: { size?: number }) {
  return (
    <svg className="as-us" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <defs><clipPath id="as-ke-c"><circle cx="10" cy="10" r="10" /></clipPath></defs>
      <g clipPath="url(#as-ke-c)">
        <rect width="20" height="20" fill="#fff" />
        <rect width="20" height="6" fill="#000" />
        <rect y="7" width="20" height="6" fill="#BB0000" />
        <rect y="14" width="20" height="6" fill="#006600" />
        <ellipse cx="10" cy="10" rx="2.6" ry="5" fill="#BB0000" stroke="#000" strokeWidth=".6" />
        <rect x="9.6" y="5.6" width=".8" height="8.8" fill="#fff" />
      </g>
    </svg>
  );
}

/**
 * Deriv account switcher. Every row is the real Deriv account (ROT… real, DOT… demo) with the balance Deriv reports.
 * Whatever is selected here is exactly the account that trades. USD / KSh only changes how balances are shown.
 */
export function AccountSwitcher({ preview, onResetDemo }: { preview: boolean; onResetDemo: () => void }) {
  const auth = useAuth();
  const fx = useDisplayCurrency();
  const shownBalance = showMoney(parseAmount(auth.balance), auth.account?.currency, fx);
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

  const root = box.current?.closest('.tp') as HTMLElement | null;
  const rootStyle = { ...Object.fromEntries(Array.from(root?.style ?? []).filter((k) => k.startsWith('--')).map((k) => [k, root!.style.getPropertyValue(k)])), display: 'contents' } as CSSProperties;
  const list = auth.accounts.filter((a) => (tab === 'demo' ? a.isVirtual : !a.isVirtual));
  const pick = (a: Account) => { auth.setAccountId(a.id); setOpen(false); };

  return (
    <div className="as" ref={box}>
      <button ref={btn} className={`as-btn ${account?.isVirtual ? "demo" : "real"}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="as-flag">{account?.isVirtual ? 'Demo' : 'Real'}</span>
        <span className="as-main">
          <b className="mono" key={fx.cur}>{parseAmount(auth.balance) === undefined ? auth.balance : shownBalance}</b>
          <small className="mono as-id">{fx.cur === 'KES' && (account?.currency ?? 'USD') === 'USD' ? <KenyaFlag size={13} /> : <CurrencyIcon currency={account?.currency} size={13} />}{account?.id}</small>
        </span>
        <svg className="as-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && createPortal(
        // EDIT HERE: the account card lives on <body> (above every panel, tab and floating button), wrapped in a copy of the
        // site root's classes and colour variables so the site's colours and dark mode still apply.
        <div className={`${root?.className ?? ''} as-root`} style={rootStyle} data-theme={root?.dataset.theme}>
        <div className="as-overlay" onMouseDown={() => setOpen(false)}>
        <div className="as-panel as-float" role="dialog" aria-label="Deriv accounts" style={{ top: pos.top / fitScale(), right: pos.right / fitScale() }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="as-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'real'} className={tab === 'real' ? 'on' : ''} onClick={() => setTab('real')}>Real</button>
            <button role="tab" aria-selected={tab === 'demo'} className={tab === 'demo' ? 'on' : ''} onClick={() => setTab('demo')}>Demo</button>
          </div>
          {/* EDIT HERE: display currency switch (USD / KSh). The account still trades in USD. */}
          <div className="as-curpick" role="radiogroup" aria-label="Show balances in">
            <span className="as-curpick-l">Show in</span>
            <button role="radio" aria-checked={fx.cur === 'USD'} className={fx.cur === 'USD' ? 'on' : ''} onClick={() => setDisplayCur('USD')}><CurrencyIcon currency="USD" size={16} /> USD</button>
            <button role="radio" aria-checked={fx.cur === 'KES'} className={fx.cur === 'KES' ? 'on' : ''} onClick={() => setDisplayCur('KES')}><KenyaFlag /> KSh</button>
          </div>
          <ul className="as-list">
            {list.length === 0 && <li className="as-empty">{tab === 'real' ? 'No real account yet.' : 'No demo account.'}{tab === 'real' && <a href="https://app.deriv.com" target="_blank" rel="noreferrer"> Open one on Deriv ↗</a>}</li>}
            {list.map((a) => {
              const on = a.id === account?.id;
              return (
                <li key={a.id}>
                  <button className={`as-row ${on ? 'on' : ''}`} disabled={a.active === false} onClick={() => pick(a)}>
                    <CurrencyIcon currency={a.currency} />
                    <span className="as-row-main">
                      <b>{a.isVirtual ? 'Demo' : 'Real'} {a.currency ?? ''}</b>
                      <small className="mono">{a.id}{a.active === false ? ' · inactive' : ''}</small>
                    </span>
                    <span className="as-bal mono">{loading && a.balance === undefined ? '…' : on && parseAmount(auth.balance) !== undefined ? shownBalance : showMoney(a.balance, a.currency, fx)}</span>
                    {on && <span className="as-tick" aria-label="Selected">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {fx.cur === 'KES' && (
            <div className="as-rate" aria-live="polite">
              {fx.rate
                ? <><span className="dot dot-real pulse" /> 1 USD = <b className={`mono ${fx.change > 0 ? 'up' : fx.change < 0 ? 'down' : ''}`}>{fx.rate.toFixed(3)}</b> KSh{fx.change > 0 ? ' ▲' : fx.change < 0 ? ' ▼' : ''}
                    <small>Live rate · {fx.source} · trades stay in USD</small></>
                : <small>Getting the live shilling rate…</small>}
            </div>
          )}
          <div className="as-foot">
            {tab === 'demo' && account?.isVirtual && !preview && <button className="btn btn-secondary" onClick={() => { setOpen(false); onResetDemo(); }}>Reset demo balance</button>}
            {tab === 'real' && <span className="row" style={{ gap: 6 }}><a className="btn btn-primary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Deposit ↗</a><a className="btn btn-secondary" href={DERIV_CASHIER} target="_blank" rel="noreferrer">Withdraw ↗</a></span>}
            <span className="hint">{loading ? 'Updating from Deriv…' : 'Balances from Deriv'}</span>
          </div>
        </div>
        </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
