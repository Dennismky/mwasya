/**
 * Deriv automated trading (auto_*) — Deriv runs the strategy server-side.
 * Docs: https://developers.deriv.com/llms/auto-start.md
 * All calls except listStrategies need the account's private (OTP) socket, scope `trade`.
 */
import type { BotSpec, DerivStrategy } from '../shared/botSpec';
import { toAutoStart } from '../shared/botSpec';
import { publicSocket, type DerivSocket } from './derivWs';

export interface RunContract {
  contract_id: number;
  buy_price: number;
  purchase_time: number;
  contract_status?: 'open' | 'won' | 'lost';
  sell_price?: number;
  sell_time?: number;
}

export interface AutoRun {
  run_id: string;
  status: 'running' | 'paused' | 'stopped';
  strategy_id: string;
  strategy_parameters: Record<string, unknown>;
  contract_template: Record<string, unknown>;
  start_time: number;
  stop_time?: number;
  stop_reason?: 'error' | 'user_stopped' | 'condition_triggered';
  stop_reason_code?: string;
  contracts?: RunContract[];
  total_stake?: number;
  total_payout?: number;
}

type Msg = Record<string, unknown>;
const errOf = (m: Msg) => (m.error as { message?: string; code?: string } | undefined);

let strategiesCache: Promise<DerivStrategy[]> | undefined;
export function listStrategies(): Promise<DerivStrategy[]> {
  strategiesCache ??= (async () => {
    const ws = publicSocket();
    try {
      const r = await ws.send<{ auto_list_strategies: { strategies: DerivStrategy[] } }>({ auto_list_strategies: 1 });
      return r.auto_list_strategies.strategies;
    } finally {
      ws.close();
    }
  })().catch((e) => { strategiesCache = undefined; throw e; });
  return strategiesCache;
}

/**
 * Start a run and stream updates. `onUpdate` receives the full run on every change.
 * Returns the initial run and an unsubscribe function (the run keeps going — call stopRun to end it).
 */
export async function startRun(
  ws: DerivSocket,
  spec: BotSpec,
  onUpdate: (run: AutoRun) => void,
  onError: (message: string) => void,
): Promise<() => void> {
  return ws.subscribe(toAutoStart(spec), (m) => {
    const e = errOf(m);
    if (e) return onError(e.message ?? 'Deriv rejected the bot');
    const run = (m.auto_start ?? m.auto_get) as AutoRun | undefined;
    if (run) onUpdate(run);
  });
}

/** Re-attach to an existing run (e.g. after a page reload). */
export function watchRun(ws: DerivSocket, runId: string, onUpdate: (run: AutoRun) => void, onError: (message: string) => void) {
  return ws.subscribe({ auto_get: 1, run_id: runId }, (m) => {
    const e = errOf(m);
    if (e) return onError(e.message ?? 'Could not load the run');
    const run = m.auto_get as AutoRun | undefined;
    if (run) onUpdate(run);
  });
}

export interface OpenContractUpdate {
  contract_id: number;
  status: 'open' | 'won' | 'lost' | 'sold' | 'cancelled';
  is_sold: boolean;
  buy_price: number;
  sell_price?: number;
  sell_time?: number;
}

/**
 * Follow one contract until it closes (https://developers.deriv.com/llms/proposal-open-contract.md).
 * Used for the last trade of a stopped run: Deriv ends the run's stream at stop, but an open
 * contract still runs to completion — this is how we learn its result.
 */
export function watchContract(ws: DerivSocket, contractId: number, onUpdate: (c: OpenContractUpdate) => void, onError: (m: string) => void) {
  return ws.subscribe({ proposal_open_contract: 1, contract_id: contractId }, (m) => {
    const e = errOf(m);
    if (e) return onError(e.message ?? 'Could not follow the contract');
    const c = m.proposal_open_contract as Record<string, unknown> | undefined;
    if (!c || typeof c.contract_id !== 'number') return;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
    onUpdate({
      contract_id: c.contract_id,
      status: (c.status as OpenContractUpdate['status']) ?? 'open',
      is_sold: c.is_sold === 1,
      buy_price: num(c.buy_price) ?? 0,
      sell_price: num(c.sell_price),
      sell_time: num(c.sell_time),
    });
  });
}

export async function getRun(ws: DerivSocket, runId: string): Promise<AutoRun> {
  const r = await ws.send<{ auto_get: AutoRun }>({ auto_get: 1, run_id: runId });
  return r.auto_get;
}

/** Contracts still open in a run (no result yet). */
export const openContracts = (run: AutoRun) =>
  (run.contracts ?? []).filter((c) => !c.contract_status || c.contract_status === 'open');

/** Totals from the trades themselves (includes a last trade that settled after stop). */
export function runTotals(run: AutoRun) {
  const cs = run.contracts ?? [];
  if (!cs.length) return { stake: run.total_stake ?? 0, payout: run.total_payout ?? 0 };
  const stake = cs.reduce((s, c) => s + (c.buy_price ?? 0), 0);
  const payout = cs.reduce((s, c) => s + (c.contract_status === 'won' || c.contract_status === 'lost' ? (c.sell_price ?? 0) : 0), 0);
  return { stake: Math.max(stake, run.total_stake ?? 0), payout: Math.max(payout, run.total_payout ?? 0) };
}

export async function listRuns(ws: DerivSocket): Promise<AutoRun[]> {
  const r = await ws.send<{ auto_list: { runs: AutoRun[] } }>({ auto_list: 1 });
  return r.auto_list?.runs ?? [];
}

const control = (verb: 'auto_pause' | 'auto_resume' | 'auto_stop') =>
  async (ws: DerivSocket, runId: string): Promise<AutoRun> => {
    const r = await ws.send<Msg>({ [verb]: 1, run_id: runId });
    return r[verb] as AutoRun;
  };

export const pauseRun = control('auto_pause');
export const resumeRun = control('auto_resume');
export const stopRun = control('auto_stop');

/** Settled P/L: payout of finished trades minus their stakes (open trades don't count yet). */
export function runPnL(run: AutoRun): number {
  const cs = run.contracts ?? [];
  if (!cs.length) return (run.total_payout ?? 0) - (run.total_stake ?? 0);
  return cs.reduce((s, c) => (c.contract_status === 'won' || c.contract_status === 'lost' ? s + (c.sell_price ?? 0) - c.buy_price : s), 0);
}
