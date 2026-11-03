import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotSpec } from '../shared/botSpec';
import { listRuns, pauseRun, resumeRun, startRun, stopRun, watchRun, type AutoRun } from './autoTrade';
import { accountSocket, type DerivSocket } from './derivWs';

export type Launch = { phase: 'idle'; key?: string } | { phase: 'starting'; key?: string } | { phase: 'running'; runId: string; key?: string } | { phase: 'error'; message: string; key?: string };
export type Conn = 'connecting' | 'ready' | 'error';

/**
 * Runs bots on one Deriv account via the auto_* API and keeps live run state.
 * Reconnects after drops and re-attaches to runs that are still going.
 * `key` lets a page track which bot a launch belongs to (e.g. a bot id).
 */
export function useBotRunner(accountId: string | undefined, onExpired: () => void) {
  const [runs, setRuns] = useState<Record<string, AutoRun>>({});
  const [launch, setLaunch] = useState<Launch>({ phase: 'idle' });
  const [conn, setConn] = useState<Conn>('connecting');
  const [connError, setConnError] = useState('');
  const ws = useRef<DerivSocket | null>(null);
  const unsubs = useRef<Map<string, () => void>>(new Map());
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;

  const onRunUpdate = useCallback((run: AutoRun) => setRuns((r) => ({ ...r, [run.run_id]: run })), []);

  useEffect(() => {
    if (!accountId) return;
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
      subs.clear();
      setConn('connecting');
      retry = setTimeout(attach, 2000);
    });
    attach();
    return () => { cancelled = true; clearTimeout(retry); offDisconnect(); subs.forEach((u) => u()); subs.clear(); sock.close(); ws.current = null; };
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
