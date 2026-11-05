import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchAccounts, type Account } from './accounts';
import { getSession, logout } from './derivAuth';
import { accountSocket } from './derivWs';

export type AuthStatus = 'checking' | 'signed-out' | 'ready' | 'error';

export interface Me {
  operator: { id: string; role: 'owner' | 'operator'; status: 'active' | 'suspended'; paidUntil: string | null; parent: { name: string | null; subdomain: string | null } | null };
  billing: { priceKes: number; periodDays: number; required: boolean; active: boolean; mpesa: boolean };
}

interface AuthState {
  status: AuthStatus;
  error: string;
  /** False when the session predates the database (bots need a fresh login). */
  operator: boolean;
  /** Role + billing (null until loaded, or when not an operator). */
  me: Me | null;
  /** True when the account is suspended by the platform owner. */
  suspended: boolean;
  reloadMe: () => Promise<void>;
  accounts: Account[];
  account: Account | undefined;
  setAccountId: (id: string) => void;
  balance: string;
  /** Re-read the balance from Deriv now (call after a trade settles). */
  refreshBalance: () => void;
  /** Call when any API returns 401 / SESSION_EXPIRED. */
  expire: () => void;
  /** Re-read every account (ID, type, balance) from Deriv. */
  reloadAccounts: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const KEY_ACCOUNT = 'mw_account';

/** `live` = open a trading connection for the live balance. Off on the studio (mwasya.site has no trading). */
export function AuthProvider({ children, live = true }: { children: ReactNode; live?: boolean }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [error, setError] = useState('');
  const [operator, setOperator] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [suspended, setSuspended] = useState(false);
  const reloadMe = useCallback(async () => {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    if (r.status === 403) { setSuspended(true); setMe(null); return; }
    if (r.status === 401) { setOperator(false); setMe(null); return; }
    if (r.ok) setMe((await r.json()) as Me);
  }, []);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountIdState] = useState('');
  const [balance, setBalance] = useState('—');
  const refreshRef = useRef<() => void>(() => undefined);

  const expire = useCallback(() => {
    setAccounts([]);
    setAccountIdState('');
    setError('Your Deriv session has ended. Please log in again.');
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (!s.loggedIn) return setStatus('signed-out');
      setOperator(Boolean(s.operator));
      if (s.operator) await reloadMe().catch(() => undefined);
      const list = await fetchAccounts();
      if (list === 'expired') return expire();
      setAccounts(list);
      const saved = localStorage.getItem(KEY_ACCOUNT);
      setAccountIdState((list.find((a) => a.id === saved) ?? list.find((a) => a.isVirtual) ?? list[0])?.id ?? '');
      setStatus('ready');
    })().catch((e: Error) => { setError(e.message || 'Something went wrong.'); setStatus('error'); });
  }, [expire, reloadMe]);

  // Live balance for the selected account — always the real number from Deriv:
  // 1) Deriv's balance stream, re-subscribed after any drop,
  // 2) a fresh read every 10s (Deriv's own bot engine may not push to this socket),
  // 3) an immediate read whenever a page calls refreshBalance() (e.g. a trade settled).
  useEffect(() => {
    if (!accountId || !live) return;
    setBalance('—');
    const ws = accountSocket(accountId);
    let stop: (() => void) | undefined;
    let cancelled = false;
    let resub: ReturnType<typeof setTimeout> | undefined;

    const show = (msg: Record<string, unknown>) => {
      const b = msg.balance as { balance?: number | string; currency?: string } | undefined;
      const n = typeof b?.balance === 'string' ? Number(b.balance) : b?.balance;
      if (!cancelled && typeof n === 'number' && Number.isFinite(n)) setBalance(`${n.toFixed(2)} ${b?.currency ?? ''}`.trim());
    };
    const onErr = (e: Error) => { if (e.message === 'SESSION_EXPIRED') expire(); };
    const subscribe = () => {
      ws.subscribe({ balance: 1 }, show).then((u) => { stop = u; }).catch(onErr);
    };
    const read = () => { if (!cancelled) ws.send({ balance: 1 }).then(show).catch(onErr); };

    refreshRef.current = read;
    subscribe();
    const poll = setInterval(read, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') read(); };
    document.addEventListener('visibilitychange', onVisible);
    const offDisconnect = ws.onDisconnect(() => { resub = setTimeout(subscribe, 1500); });

    return () => {
      cancelled = true;
      refreshRef.current = () => undefined;
      clearInterval(poll);
      clearTimeout(resub);
      document.removeEventListener('visibilitychange', onVisible);
      offDisconnect();
      stop?.();
      ws.close();
    };
  }, [accountId, expire, live]);

  const refreshBalance = useCallback(() => refreshRef.current(), []);

  const setAccountId = useCallback((id: string) => {
    localStorage.setItem(KEY_ACCOUNT, id);
    setAccountIdState(id);
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    localStorage.removeItem(KEY_ACCOUNT);
    setAccounts([]);
    setAccountIdState('');
    setError('');
    setStatus('signed-out');
  }, []);

  const reloadAccounts = useCallback(async () => {
    const list = await fetchAccounts().catch(() => null);
    if (list === 'expired') return expire();
    if (list) setAccounts(list);
  }, [expire]);

  const value = useMemo<AuthState>(() => ({
    status, error, operator, me, suspended, reloadMe, accounts, balance, refreshBalance, expire, signOut, setAccountId, reloadAccounts,
    account: accounts.find((a) => a.id === accountId),
  }), [status, error, operator, me, suspended, reloadMe, accounts, accountId, balance, refreshBalance, expire, signOut, setAccountId, reloadAccounts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Owner/mentor "Preview as client": a pretend demo account, no Deriv connection, nothing can be traded. */
export const PREVIEW_ACCOUNT_ID = 'PREVIEW';
export function PreviewAuthProvider({ children }: { children: ReactNode }) {
  const account: Account = { id: PREVIEW_ACCOUNT_ID, label: 'Demo · USD · preview', currency: 'USD', isVirtual: true, balance: 10000, active: true };
  const value = useMemo<AuthState>(() => ({
    status: 'ready', error: '', operator: false, me: null, suspended: false, reloadMe: async () => undefined,
    accounts: [account], account, setAccountId: () => undefined, balance: '10000.00 USD',
    refreshBalance: () => undefined, expire: () => undefined, signOut: async () => { window.close(); }, reloadAccounts: async () => undefined,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
