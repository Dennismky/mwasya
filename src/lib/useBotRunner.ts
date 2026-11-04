import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotSpec } from '../shared/botSpec';
import { getRun, listRuns, openContracts, pauseRun, resumeRun, startRun, stopRun, watchContract, watchRun, type AutoRun } from './autoTrade';

/** Never let a stale update turn a settled trade back into "open". */
function mergeRun(prev: AutoRun | undefined, next: AutoRun): AutoRun {
  if (!prev?.contracts?.length || !next.contracts) return next;
  const known = new Map(prev.contracts.map((c) => [c.contract_id, c]));
  return {
    ...next,
    contracts: next.contracts.map((c) => {
      const old = known.get(c.contract_id);
      const nextOpen = !c.contract_status || c.contract_status === 'open';
      return old && nextOpen && (old.contract_status === 'won' || old.contract_status === 'lost') ? old : c;
    }),
  };
}
import { accountSocket, type DerivSocket } from './derivWs';

export type Launch = { phase: 'idle'; key?: string } | { phase: 'starting'; key?: string } | { phase: 'running'; runId: string; key?: string } | { phase: 'error'; message: string; key?: string };
export type Conn = 'connecting' | 'ready' | 'error';

/**
 * Runs bots on one Deriv account via the auto_* API and keeps live run state.
 * Reconnects after drops and re-attaches to runs that are still going.
 * `key` lets a page track which bot a launch belongs to (e.g. a bot id).
 */
export function useBotRunner(accountId: string | undefined, onExpired: () => void, onTrade?: () => void) {
  const [runs, setRuns] = useState<Record<string, AutoRun>>({});
  const [launch, setLaunch] = useState<Launch>({ phase: 'idle' });
  const [conn, setConn] = useState<Conn>('connecting');
  const [connError, setConnError] = useState('');
  const ws = useRef<DerivSocket | null>(null);
  const unsubs = useRef<Map<string, () => void>>(new Map());
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  const tradeRef = useRef(onTrade);
  tradeRef.current = onTrade;
  const tradeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Every run update is a buy or a settle → refresh the real balance (debounced to respect Deriv's rate limit).
  const bumpBalance = useCallback(() => {
    clearTimeout(tradeTimer.current);
    tradeTimer.current = setTimeout(() => tradeRef.current?.(), 1200);
  }, []);
  const onRunUpdate = useCallback((run: AutoRun) => {
    setRuns((r) => ({ ...r, [run.run_id]: mergeRun(r[run.run_id], run) }));
    bumpBalance();
  }, [bumpBalance]);

  // After Stop, Deriv ends the run's stream but an open contract still runs to completion.
  // Follow each such contract until it settles so its result (and payout) is never lost.
  const tracked = useRef(new Map<number, { unsub?: () => void; done: boolean }>());
  useEffect(() => {
    const sock = ws.current;
    if (!sock) return;
    for (const run of Object.values(runs)) {
      if (run.status !== 'stopped') continue;
      for (const c of openContracts(run)) {
        if (tracked.current.has(c.contract_id)) continue;
        const entry: { unsub?: () => void; done: boolean } = { done: false };
        tracked.current.set(c.contract_id, entry);
        watchContract(sock, c.contract_id, (u) => {
          const closed = u.is_sold || u.status === 'won' || u.status === 'lost' || u.status === 'sold' || u.status === 'cancelled';
          if (!closed || entry.done) return;
          entry.done = true;
          entry.unsub?.();
          const sell = u.sell_price ?? 0;
          const status: 'won' | 'lost' = u.status === 'won' || u.status === 'lost' ? u.status : sell > u.buy_price ? 'won' : 'lost';
          setRuns((r) => {
            const cur = r[run.run_id];
            if (!cur) return r;
            const contracts = (cur.contracts ?? []).map((x) =>
              x.contract_id === u.contract_id ? { ...x, contract_status: status, sell_price: sell, sell_time: u.sell_time ?? x.sell_time } : x);
            return { ...r, [run.run_id]: { ...cur, contracts } };
          });
          bumpBalance();
          // Then take Deriv's own final numbers for the run.
          getRun(sock, run.run_id).then(onRunUpdate).catch(() => undefined);
        }, () => undefined)
          .then((unsub) => { if (entry.done) unsub(); else entry.unsub = unsub; })
          .catch(() => tracked.current.delete(c.contract_id)); // retry on next update
      }
    }
  }, [runs, bumpBalance, onRunUpdate]);

  useEffect(() => {
    if (!accountId || accountId === 'PREVIEW') return; // studio preview: no Deriv connection
    const sock = accountSocket(accountId);
    ws.current = sock;
    setRuns({});
    setLaunch({ phase: 'idle' });
    setConn('connecting');
    const subs = unsubs.current;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const attach = () => {
      listRuns(sock)
        .then((list) => {
          if (cancelled) return;
          setConn('ready');
          const map: Record<string, AutoRun> = {};
          for (const run of list) {
            map[run.run_id] = run;
            if (run.status !== 'stopped' && !subs.has(run.run_id)) {
              watchRun(sock, run.run_id, onRunUpdate, () => undefined).then((u) => subs.set(run.run_id, u)).catch(() => undefined);
            }
          }
          setRuns((prev) => ({ ...prev, ...map }));
        })
        .catch((e: Error) => {
          if (cancelled) return;
          if (e.message === 'SESSION_EXPIRED') return expiredRef.current();
          setConn('error');
          setConnError(e.message);
        });
    };
    const offDisconnect = sock.onDisconnect(() => {
      subs.clear(); // stream listeners died with the socket
      for (const [id, t] of tracked.current) if (!t.done) tracked.current.delete(id); // re-follow open contracts after reconnect
      setConn('connecting');
      retry = setTimeout(attach, 2000);
    });
    attach();
    const trackedMap = tracked.current;
    return () => { cancelled = true; clearTimeout(retry); offDisconnect(); subs.forEach((u) => u()); subs.clear(); trackedMap.forEach((t) => t.unsub?.()); trackedMap.clear(); sock.close(); ws.current = null; };
  }, [accountId, onRunUpdate]);

  const start = useCallback(async (spec: BotSpec, key?: string) => {
    if (!ws.current) return setLaunch({ phase: 'error', message: 'Still connecting to your Deriv account. Try again in a moment.', key });
    setLaunch({ phase: 'starting', key });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message === 'SESSION_EXPIRED') return expiredRef.current();
      setLaunch({ phase: 'error', message, key });
    };
    const timer = setTimeout(() => fail('Deriv did not confirm the run within 20 seconds. Check your runs below before trying again.'), 20_000);
    let unsub: (() => void) | undefined;
    try {
      unsub = await startRun(ws.current, spec, (r) => {
        onRunUpdate(r);
        if (unsub) unsubs.current.set(r.run_id, unsub);
        if (!settled) { settled = true; clearTimeout(timer); setLaunch({ phase: 'running', runId: r.run_id, key }); }
      }, fail);
    } catch (e) {
      fail((e as Error).message);
    }
  }, [onRunUpdate]);

  const control = useCallback(async (action: 'pause' | 'resume' | 'stop', runId: string): Promise<string | null> => {
    if (!ws.current) return 'Not connected';
    const fn = action === 'pause' ? pauseRun : action === 'resume' ? resumeRun : stopRun;
    try { onRunUpdate(await fn(ws.current, runId)); return null; } catch (e) { return (e as Error).message; }
  }, [onRunUpdate]);

  return { runs, launch, conn, connError, start, control };
}
