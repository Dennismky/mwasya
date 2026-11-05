import { useCallback, useEffect, useRef, useState } from 'react';
import { accountSocket, type DerivSocket } from '../lib/derivWs';
import { decimalsOf, lastDigit, subscribeTicks, tickHistory } from './ticks';
import { XmlBot } from './xmlRunner';

/** A Bot Builder strategy. Everything a client sets in the builder steps. */
export interface BotConfig {
  symbol: string;
  contract: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'CALL' | 'PUT';
  prediction: number;          // digit for Over/Under/Matches/Differs
  ticks: number;               // contract duration in ticks
  stake: number;               // initial stake
  recovery: boolean;           // raise the stake after a loss
  recoveryMode?: 'multiply' | 'add'; // multiply: stake × k · add: stake + loss × k
  multiplier: number;          // martingale factor
  maxStake: number;            // stake never goes above this (0 = no cap)
  takeProfit: number;          // stop when total profit ≥ this
  stopLoss: number;            // stop when total loss ≥ this
  maxRuns: number;             // 0 = unlimited
  entryDigit: number | null;   // only buy right after a tick whose last digit is this
}

export const DEFAULT_CONFIG: BotConfig = {
  symbol: '1HZ25V', contract: 'DIGITOVER', prediction: 1, ticks: 1, stake: 0.5, recovery: true, recoveryMode: 'multiply', multiplier: 2,
  maxStake: 16, takeProfit: 10, stopLoss: 50, maxRuns: 0, entryDigit: null,
};

export interface Trade { id: number; type: string; stake: number; payout: number; profit: number; entry?: number; exit?: number; status: 'open' | 'won' | 'lost'; time: number }
export interface Journal { t: number; level: 'info' | 'win' | 'loss' | 'error'; text: string }
export type BotState = 'idle' | 'running' | 'stopping';

const needsDigit = (c: BotConfig['contract']) => ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(c);

/** Client-side bot (like Deriv Bot): proposal → buy → follow the contract → next, until a limit or Stop. */
export function useBotEngine(accountId: string | undefined, currency: string, onTrade?: () => void) {
  const [state, setState] = useState<BotState>('idle');
  const [trades, setTrades] = useState<Trade[]>([]);
  const [journal, setJournal] = useState<Journal[]>([]);
  const ws = useRef<DerivSocket | null>(null);
  const stopFlag = useRef(false);
  const tradeRef = useRef(onTrade);
  tradeRef.current = onTrade;

  useEffect(() => {
    if (!accountId || accountId === 'PREVIEW') return;
    const s = accountSocket(accountId);
    ws.current = s;
    return () => { stopFlag.current = true; s.close(); ws.current = null; };
  }, [accountId]);

  const log = useCallback((level: Journal['level'], text: string) => setJournal((j) => [{ t: Date.now(), level, text }, ...j].slice(0, 300)), []);

  const waitForDigit = (symbol: string, digit: number) => new Promise<void>((resolve) => {
    const seen: number[] = [];
    const off = subscribeTicks(symbol, (q) => {
      seen.push(q);
      if (stopFlag.current) { off(); return resolve(); }
      if (lastDigit(q, decimalsOf(seen.slice(-20))) === digit) { off(); resolve(); }
    });
  });

  const followContract = (s: DerivSocket, id: number) => new Promise<Record<string, unknown>>((resolve, reject) => {
    let unsub: (() => void) | undefined;
    let done = false;
    s.subscribe({ proposal_open_contract: 1, contract_id: id }, (m) => {
      const err = m.error as { message?: string } | undefined;
      if (err) { done = true; unsub?.(); return reject(new Error(err.message ?? 'Contract error')); }
      const c = m.proposal_open_contract as Record<string, unknown> | undefined;
      if (c && c.is_sold === 1 && !done) { done = true; unsub?.(); resolve(c); }
    }).then((u) => { unsub = u; if (done) u(); }).catch(reject);
  });

  const run = useCallback(async (cfg: BotConfig) => {
    const s = ws.current;
    if (!s || state !== 'idle') return;
    stopFlag.current = false;
    setState('running');
    log('info', `Bot started on ${cfg.symbol}: ${cfg.contract}${needsDigit(cfg.contract) ? ` ${cfg.prediction}` : ''}, ${cfg.ticks} tick(s), stake ${cfg.stake.toFixed(2)} ${currency}.`);
    let stake = cfg.stake, pnl = 0, runs = 0;
    try {
      while (!stopFlag.current) {
        if (cfg.maxRuns && runs >= cfg.maxRuns) { log('info', `Reached ${cfg.maxRuns} runs.`); break; }
        if (cfg.entryDigit !== null) {
          log('info', `Waiting for last digit ${cfg.entryDigit}…`);
          await waitForDigit(cfg.symbol, cfg.entryDigit);
          if (stopFlag.current) break;
        }
        const req: Record<string, unknown> = { proposal: 1, amount: Number(stake.toFixed(2)), basis: 'stake', contract_type: cfg.contract, currency, underlying_symbol: cfg.symbol, duration: cfg.ticks, duration_unit: 't' };
        if (needsDigit(cfg.contract)) req.barrier = String(cfg.prediction);
        const p = await s.send<{ proposal: { id: string; ask_price: number; payout: number } }>(req);
        const b = await s.send<{ buy: { contract_id: number; buy_price: number } }>({ buy: p.proposal.id, price: p.proposal.ask_price });
        runs++;
        const id = b.buy.contract_id;
        setTrades((t) => [{ id, type: cfg.contract, stake: b.buy.buy_price, payout: p.proposal.payout, profit: 0, status: 'open' as const, time: Date.now() }, ...t].slice(0, 500));
        log('info', `Bought #${id} for ${b.buy.buy_price.toFixed(2)} ${currency}.`);
        const c = await followContract(s, id);
        const profit = Number(c.profit ?? 0);
        const won = profit > 0;
        pnl += profit;
        setTrades((t) => t.map((x) => (x.id === id ? { ...x, profit, status: won ? 'won' : 'lost', entry: Number(c.entry_spot ?? 0) || undefined, exit: Number(c.exit_spot ?? 0) || undefined } : x)));
        log(won ? 'win' : 'loss', `${won ? 'Won' : 'Lost'} ${Math.abs(profit).toFixed(2)} ${currency}. Total ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}.`);
        tradeRef.current?.();
        if (cfg.takeProfit > 0 && pnl >= cfg.takeProfit) { log('win', `Take profit reached (+${pnl.toFixed(2)}).`); break; }
        if (cfg.stopLoss > 0 && -pnl >= cfg.stopLoss) { log('loss', `Stop loss reached (${pnl.toFixed(2)}).`); break; }
        // Recovery: multiply after a loss (capped), back to the initial stake after a win.
        if (!won && cfg.recovery) {
          const next = cfg.recoveryMode === 'add' ? stake + Math.abs(profit) * cfg.multiplier : stake * cfg.multiplier;
          stake = cfg.maxStake > 0 ? Math.min(next, cfg.maxStake) : next;
          // Never risk more than what is left before the stop loss.
          if (cfg.stopLoss > 0) stake = Math.min(stake, Math.max(0.35, cfg.stopLoss + pnl));
        } else stake = cfg.stake;
      }
    } catch (e) {
      log('error', (e as Error).message === 'SESSION_EXPIRED' ? 'Your session ended. Log in again.' : (e as Error).message);
    } finally {
      log('info', 'Bot stopped.');
      setState('idle');
      stopFlag.current = false;
    }
  }, [state, currency, log]);

  /** Run a Deriv Bot XML file block by block, exactly as it was built. */
  const runXml = useCallback(async (xml: string) => {
    const s = ws.current;
    if (!s || state !== 'idle') return;
    stopFlag.current = false;
    setState('running');
    try {
      const bot = new XmlBot(xml, {
        socket: s, currency, log,
        shouldStop: () => stopFlag.current,
        subscribeTicks: (sym, cb) => subscribeTicks(sym, cb),
        tickHistory,
        balance: async () => {
          const r = await s.send<{ balance: { balance: number | string } }>({ balance: 1 });
          return Number(r.balance.balance);
        },
        onBuy: ({ id, type, stake, payout }) => setTrades((t) => [{ id, type, stake, payout, profit: 0, status: 'open' as const, time: Date.now() }, ...t].slice(0, 500)),
        onSettle: ({ id, profit, won, entry, exit }) => {
          setTrades((t) => t.map((x) => (x.id === id ? { ...x, profit, status: won ? 'won' : 'lost', entry, exit } : x)));
          tradeRef.current?.();
        },
      });
      await bot.run();
    } catch (e) {
      log('error', (e as Error).message === 'SESSION_EXPIRED' ? 'Your session ended. Log in again.' : (e as Error).message);
    } finally {
      log('info', 'Bot stopped.');
      setState('idle');
      stopFlag.current = false;
    }
  }, [state, currency, log]);

  const stop = useCallback(() => {
    if (state !== 'running') return;
    stopFlag.current = true;
    setState('stopping');
    log('info', 'Stopping after the current trade…');
  }, [state, log]);

  const reset = useCallback(() => { if (state === 'idle') { setTrades([]); setJournal([]); } }, [state]);

  // Other tools (Manual Trader, …) log their trades here too, so every page shows one Journal.
  const recordBuy = useCallback((t: { id: number; type: string; stake: number; payout: number; source: string }) => {
    setTrades((x) => [{ id: t.id, type: t.type, stake: t.stake, payout: t.payout, profit: 0, status: 'open' as const, time: Date.now() }, ...x.filter((y) => y.id !== t.id)].slice(0, 500));
    log('info', `${t.source}: bought ${t.type} #${t.id} for ${t.stake.toFixed(2)} ${currency}.`);
  }, [log, currency]);
  const recordSettle = useCallback((t: { id: number; profit: number; source: string; entry?: number; exit?: number }) => {
    const won = t.profit > 0;
    setTrades((x) => x.map((y) => (y.id === t.id ? { ...y, profit: t.profit, status: won ? 'won' as const : 'lost' as const, entry: t.entry, exit: t.exit } : y)));
    log(won ? 'win' : 'loss', `${t.source}: ${won ? 'won' : 'lost'} ${Math.abs(t.profit).toFixed(2)} ${currency} on #${t.id}.`);
  }, [log, currency]);

  const settled = trades.filter((t) => t.status !== 'open');
  const summary = {
    stake: settled.reduce((s, t) => s + t.stake, 0),
    payout: settled.reduce((s, t) => s + (t.status === 'won' ? t.stake + t.profit : 0), 0),
    runs: trades.length,
    won: settled.filter((t) => t.status === 'won').length,
    lost: settled.filter((t) => t.status === 'lost').length,
    pnl: settled.reduce((s, t) => s + t.profit, 0),
  };
  return { state, trades, journal, summary, run, runXml, stop, reset, recordBuy, recordSettle, log, ready: !!ws.current };
}
