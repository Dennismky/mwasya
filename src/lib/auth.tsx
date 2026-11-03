import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchAccounts, type Account } from './accounts';
import { getSession, logout } from './derivAuth';
import { accountSocket } from './derivWs';

export type AuthStatus = 'checking' | 'signed-out' | 'ready' | 'error';

interface AuthState {
  status: AuthStatus;
  error: string;
  /** False when the session predates the database (bots need a fresh login). */
  operator: boolean;
  accounts: Account[];
  account: Account | undefined;
  setAccountId: (id: string) => void;
  balance: string;
  /** Call when any API returns 401 / SESSION_EXPIRED. */
  expire: () => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const KEY_ACCOUNT = 'mw_account';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [error, setError] = useState('');
  const [operator, setOperator] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountIdState] = useState('');
  const [balance, setBalance] = useState('—');

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
      const list = await fetchAccounts();
      if (list === 'expired') return expire();
      setAccounts(list);
      const saved = localStorage.getItem(KEY_ACCOUNT);
      setAccountIdState((list.find((a) => a.id === saved) ?? list.find((a) => a.isVirtual) ?? list[0])?.id ?? '');
      setStatus('ready');
    })().catch((e: Error) => { setError(e.message || 'Something went wrong.'); setStatus('error'); });
  }, [expire]);

  // Live balance for the selected account
  useEffect(() => {
    if (!accountId) return;
    setBalance('—');
    const ws = accountSocket(accountId);
    let stop: (() => void) | undefined;
    ws.subscribe({ balance: 1 }, (msg) => {
      const b = msg.balance as { balance?: number; currency?: string } | undefined;
      if (b?.balance !== undefined) setBalance(`${b.balance.toFixed(2)} ${b.currency ?? ''}`.trim());
    })
      .then((u) => { stop = u; })
      .catch((e: Error) => { if (e.message === 'SESSION_EXPIRED') expire(); });
    return () => { stop?.(); ws.close(); };
  }, [accountId, expire]);

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

  const value = useMemo<AuthState>(() => ({
    status, error, operator, accounts, balance, expire, signOut, setAccountId,
    account: accounts.find((a) => a.id === accountId),
  }), [status, error, operator, accounts, accountId, balance, expire, signOut, setAccountId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
