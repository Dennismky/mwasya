import type { DerivSocket } from '../lib/derivWs';
import { decimalsOf, lastDigit } from './ticks';

/**
 * Runs a Deriv Bot (Blockly XML) file block by block, the way it was built:
 *   1. trade definition (market, contract, options) + INITIALIZATION, once
 *   2. before purchase: runs on each new tick until a Purchase block fires
 *   3. during purchase: runs on each update of the open contract (may sell early)
 *   4. after purchase: runs once the contract settles; "Trade again" loops to 2, otherwise the bot stops
 * Every trade goes to the client's own Deriv account through `socket`.
 */

export interface RunnerHooks {
  socket: DerivSocket;
  currency: string;
  log: (level: 'info' | 'win' | 'loss' | 'error', text: string) => void;
  onBuy: (t: { id: number; type: string; stake: number; payout: number }) => void;
  onSettle: (t: { id: number; profit: number; won: boolean; entry?: number; exit?: number }) => void;
  shouldStop: () => boolean;
  subscribeTicks: (symbol: string, cb: (quote: number, epoch: number) => void) => () => void;
  tickHistory: (symbol: string, count: number) => Promise<{ prices: number[]; times: number[] }>;
  balance: () => Promise<number>;
}

class Halt extends Error {}
class Break extends Error {}
class Continue extends Error {}
class Return extends Error { constructor(public value: unknown) { super('return'); } }

type Val = unknown;
const kids = (el: Element) => Array.from(el.children);
const named = (el: Element, tag: string, name: string) => kids(el).find((c) => c.tagName === tag && c.getAttribute('name') === name);
const firstBlock = (el: Element | undefined) => (el ? kids(el).find((c) => c.tagName === 'block') ?? kids(el).find((c) => c.tagName === 'shadow') : undefined);
const fieldText = (b: Element, name: string) => named(b, 'field', name)?.textContent ?? '';
const num = (v: Val) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : 0; };
const str = (v: Val) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join(',') : String(v));
const truthy = (v: Val) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

const DIGIT_TYPES = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'];

export class XmlBot {
  private doc: Document;
  private vars = new Map<string, Val>();
  private procs = new Map<string, Element>();
  private symbol = 'R_100';
  private tradeOptions: Element | undefined;
  private ticks: number[] = [];
  private tickTimes: number[] = [];
  private decimals = 2;
  private totalProfit = 0;
  private totalRuns = 0;
  private lastContract: Record<string, unknown> | null = null;
  private openContract: Record<string, unknown> | null = null;
  private purchased: { id: number; price: number } | null = null;
  private tradeAgain = false;
  private sellRequested = false;
  private steps = 0;

  constructor(xml: string, private h: RunnerHooks) {
    this.doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (this.doc.getElementsByTagName('parsererror').length) throw new Error('This is not a valid bot file.');
  }

  private top(type: string) { return Array.from(this.doc.documentElement.children).find((b) => b.tagName === 'block' && b.getAttribute('type') === type); }
  private all(type: string) { return Array.from(this.doc.getElementsByTagName('block')).filter((b) => b.getAttribute('type') === type); }
  private varKey(b: Element, field = 'VAR') { const f = named(b, 'field', field); return (f?.textContent ?? '').trim(); }

  async run() {
    const def = this.top('trade_definition') ?? this.all('trade_definition')[0];
    if (!def) throw new Error('This bot has no Trade parameters block.');
    for (const p of this.all('procedures_defnoreturn').concat(this.all('procedures_defreturn'))) this.procs.set(fieldText(p, 'NAME'), p);

    // 1. Trade parameters.
    this.symbol = this.all('trade_definition_market')[0] ? fieldText(this.all('trade_definition_market')[0], 'SYMBOL_LIST') || this.symbol : this.symbol;
    this.tradeOptions = this.all('trade_definition_tradeoptions')[0];
    if (!this.tradeOptions) {
      const other = Array.from(this.doc.getElementsByTagName('block')).find((b) => /^trade_definition_(multiplier|accumulator)/.test(b.getAttribute('type') ?? ''));
      throw new Error(other ? 'Multiplier and accumulator bots are not supported here yet.' : 'This bot has no trade options block.');
    }
    this.h.log('info', `Bot started on ${this.symbol}.`);
    const hist = await this.h.tickHistory(this.symbol, 1000);
    this.ticks = hist.prices; this.tickTimes = hist.times; this.decimals = decimalsOf(this.ticks);
    await this.execStatement(def, 'INITIALIZATION');

    // Live ticks feed the market blocks and pace "before purchase".
    let wake: (() => void) | null = null;
    const off = this.h.subscribeTicks(this.symbol, (q, t) => {
      this.ticks.push(q); this.tickTimes.push(t);
      if (this.ticks.length > 5000) { this.ticks.shift(); this.tickTimes.shift(); }
      const w = wake; wake = null; w?.();
    });
    const nextTick = () => new Promise<void>((r) => { wake = r; });
    const tickAnalysis = this.all('tick_analysis');

    try {
      for (;;) {
        if (this.h.shouldStop()) break;
        // 2. Before purchase: re-run on each tick until a purchase happens.
        this.purchased = null;
        const before = this.top('before_purchase') ?? this.all('before_purchase')[0];
        if (!before) throw new Error('This bot has no Purchase conditions block.');
        while (!this.purchased) {
          if (this.h.shouldStop()) throw new Halt();
          await nextTick();
          for (const ta of tickAnalysis) await this.execStatement(ta, 'TICKANALYSIS_STACK').catch((e) => { if (!(e instanceof Halt)) throw e; });
          await this.execStatement(before, 'BEFOREPURCHASE_STACK');
        }
        // 3. During purchase + 4. After purchase. (Set by the Purchase block inside the loop above.)
        const bought = this.purchased as unknown as { id: number; price: number };
        const settled = await this.follow(bought.id);
        this.lastContract = settled;
        this.totalRuns++;
        const profit = num(settled.profit);
        this.totalProfit += profit;
        const won = profit > 0;
        this.h.onSettle({ id: bought.id, profit, won, entry: num(settled.entry_spot) || undefined, exit: num(settled.exit_spot) || undefined });
        this.h.log(won ? 'win' : 'loss', `${won ? 'Won' : 'Lost'} ${Math.abs(profit).toFixed(2)} ${this.h.currency}. Total ${this.totalProfit >= 0 ? '+' : ''}${this.totalProfit.toFixed(2)}.`);
        this.tradeAgain = false;
        const after = this.top('after_purchase') ?? this.all('after_purchase')[0];
        if (after) await this.execStatement(after, 'AFTERPURCHASE_STACK');
        if (!this.tradeAgain) { this.h.log('info', 'The bot finished (no "Trade again").'); break; }
      }
    } catch (e) {
      if (!(e instanceof Halt)) throw e;
    } finally {
      off();
    }
  }

  /** Watch the open contract; runs "during purchase" on each update. */
  private follow(id: number) {
    const during = this.top('during_purchase') ?? this.all('during_purchase')[0];
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let unsub: (() => void) | undefined;
      let done = false;
      let busy = false;
      this.sellRequested = false;
      this.h.socket.subscribe({ proposal_open_contract: 1, contract_id: id }, (m) => {
        const err = m.error as { message?: string } | undefined;
        if (err) { done = true; unsub?.(); reject(new Error(err.message ?? 'Contract error')); return; }
        const c = m.proposal_open_contract as Record<string, unknown> | undefined;
        if (!c || done) return;
        this.openContract = c;
        if (c.is_sold === 1) { done = true; unsub?.(); resolve(c); return; }
        if (during && !busy) {
          busy = true;
          this.execStatement(during, 'DURING_PURCHASE_STACK')
            .catch((e) => { if (!(e instanceof Halt)) this.h.log('error', (e as Error).message); })
            .finally(() => { busy = false; });
        }
      }).then((u) => { unsub = u; if (done) u(); }).catch(reject);
    });
  }

  private async purchase(type: string) {
    if (this.purchased) return;
    const o = this.tradeOptions!;
    const amount = Number(num(await this.value(o, 'AMOUNT')).toFixed(2));
    const duration = Math.max(1, Math.round(num(await this.value(o, 'DURATION')) || 1));
    const unit = fieldText(o, 'DURATIONTYPE_LIST') || 't';
    const req: Record<string, unknown> = { proposal: 1, amount, basis: 'stake', contract_type: type, currency: this.h.currency, underlying_symbol: this.symbol, duration, duration_unit: unit };
    if (DIGIT_TYPES.includes(type)) req.barrier = String(Math.round(num(await this.value(o, 'PREDICTION'))));
    else if (named(o, 'value', 'BARRIEROFFSET') || named(o, 'value', 'BARRIER')) {
      const b = await this.value(o, named(o, 'value', 'BARRIER') ? 'BARRIER' : 'BARRIEROFFSET');
      const off = fieldText(o, 'BARRIEROFFSETTYPE_LIST');
      req.barrier = off === '-' ? `-${Math.abs(num(b))}` : off === '+' ? `+${Math.abs(num(b))}` : String(b);
    }
    const p = await this.h.socket.send<{ proposal: { id: string; ask_price: number; payout: number } }>(req);
    const b = await this.h.socket.send<{ buy: { contract_id: number; buy_price: number } }>({ buy: p.proposal.id, price: p.proposal.ask_price });
    this.purchased = { id: b.buy.contract_id, price: b.buy.buy_price };
    this.h.onBuy({ id: b.buy.contract_id, type, stake: b.buy.buy_price, payout: p.proposal.payout });
    this.h.log('info', `Bought ${type} #${b.buy.contract_id} for ${b.buy.buy_price.toFixed(2)} ${this.h.currency}.`);
  }

  /* ---------------- statements ---------------- */
  private async execStatement(block: Element, name: string) {
    const first = firstBlock(named(block, 'statement', name));
    if (first) await this.execChain(first);
  }
  private async execChain(start: Element | undefined) {
    for (let b = start; b; b = firstBlock(kids(b).find((c) => c.tagName === 'next'))) {
      if (b.getAttribute('disabled') === 'true') continue;
      await this.exec(b);
    }
  }
  private guard() { if (++this.steps % 2000 === 0 && this.h.shouldStop()) throw new Halt(); if (this.steps > 5_000_000) throw new Error('The bot looped too many times.'); }

  private async exec(b: Element): Promise<void> {
    this.guard();
    const type = b.getAttribute('type') ?? '';
    switch (type) {
      case 'variables_set': this.vars.set(this.varKey(b), await this.value(b, 'VALUE')); return;
      case 'math_change': this.vars.set(this.varKey(b), num(this.vars.get(this.varKey(b))) + num(await this.value(b, 'DELTA'))); return;
      case 'controls_if': {
        const mut = kids(b).find((c) => c.tagName === 'mutation');
        const elseifs = Number(mut?.getAttribute('elseif') ?? 0);
        for (let i = 0; i <= elseifs; i++) {
          if (truthy(await this.value(b, `IF${i}`))) { await this.execStatement(b, `DO${i}`); return; }
        }
        if (named(b, 'statement', 'ELSE')) await this.execStatement(b, 'ELSE');
        return;
      }
      case 'controls_repeat_ext': case 'controls_repeat': {
        const n = type === 'controls_repeat' ? num(fieldText(b, 'TIMES')) : num(await this.value(b, 'TIMES'));
        for (let i = 0; i < n; i++) { try { await this.execStatement(b, 'DO'); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; } }
        return;
      }
      case 'controls_whileUntil': {
        const until = fieldText(b, 'MODE') === 'UNTIL';
        for (;;) {
          const c = truthy(await this.value(b, 'BOOL'));
          if (until ? c : !c) break;
          try { await this.execStatement(b, 'DO'); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
        return;
      }
      case 'controls_for': {
        const key = this.varKey(b);
        const from = num(await this.value(b, 'FROM')), to = num(await this.value(b, 'TO')), by = Math.abs(num(await this.value(b, 'BY'))) || 1;
        for (let i = from; from <= to ? i <= to : i >= to; i += from <= to ? by : -by) {
          this.vars.set(key, i);
          try { await this.execStatement(b, 'DO'); } catch (e) { if (e instanceof Break) break; if (e instanceof Continue) continue; throw e; }
        }
        return;
      }
      case 'controls_flow_statements': throw fieldText(b, 'FLOW') === 'CONTINUE' ? new Continue() : new Break();
      case 'purchase': await this.purchase(fieldText(b, 'PURCHASE_LIST')); return;
      case 'trade_again': this.tradeAgain = true; return;
      case 'sell_at_market': if (!this.sellRequested && this.purchased && this.openContract?.is_valid_to_sell === 1) {
        this.sellRequested = true;
        await this.h.socket.send({ sell: this.purchased.id, price: 0 }).then(() => this.h.log('info', 'Sold early.')).catch(() => undefined);
      } return;
      case 'notify': this.h.log('info', str(await this.value(b, 'MESSAGE'))); return;
      case 'text_print': this.h.log('info', str(await this.value(b, 'TEXT'))); return;
      case 'text_join': {
        // Deriv's "set VARIABLE to text joined from these lines".
        const parts: string[] = [];
        for (let s = firstBlock(named(b, 'statement', 'STACK')); s; s = firstBlock(kids(s).find((c) => c.tagName === 'next'))) parts.push(str(await this.value(s, 'TEXT')));
        this.vars.set(this.varKey(b, 'VARIABLE'), parts.join(''));
        return;
      }
      case 'text_append': this.vars.set(this.varKey(b), str(this.vars.get(this.varKey(b))) + str(await this.value(b, 'TEXT'))); return;
      case 'procedures_callnoreturn': await this.call(b); return;
      case 'procedures_ifreturn': if (truthy(await this.value(b, 'CONDITION'))) throw new Return(await this.value(b, 'VALUE')); return;
      case 'timeout': case 'loader': case 'console': case 'tick_analysis': return;
      default:
        if (/^(trade_definition|before_purchase|during_purchase|after_purchase|procedures_def)/.test(type)) return;
        throw new Error(`The "${type.replace(/_/g, ' ')}" block is not supported yet. The bot stopped before trading on it.`);
    }
  }

  private async call(b: Element): Promise<Val> {
    const name = kids(b).find((c) => c.tagName === 'mutation')?.getAttribute('name') ?? '';
    const def = this.procs.get(name);
    if (!def) throw new Error(`Function "${name}" is missing.`);
    const args = Array.from(kids(def).find((c) => c.tagName === 'mutation')?.children ?? []).map((a) => a.getAttribute('name') ?? '');
    for (let i = 0; i < args.length; i++) this.vars.set(args[i], await this.value(b, `ARG${i}`));
    try { await this.execStatement(def, 'STACK'); } catch (e) { if (e instanceof Return) return e.value; throw e; }
    return def.getAttribute('type') === 'procedures_defreturn' ? this.value(def, 'RETURN') : undefined;
  }

  /* ---------------- values ---------------- */
  private async value(parent: Element, name: string): Promise<Val> {
    const b = firstBlock(named(parent, 'value', name));
    return b ? this.eval(b) : undefined;
  }

  private lastDigits() { return this.ticks.map((p) => lastDigit(p, this.decimals)); }

  private detail(i: number): Val {
    const c = this.lastContract ?? {};
    const profit = num(c.profit);
    switch (i) {
      case 1: return (c.transaction_ids as { buy?: number } | undefined)?.buy ?? c.contract_id;
      case 2: return num(c.buy_price);
      case 3: return num(c.payout);
      case 4: return profit;
      case 5: return c.contract_type;
      case 6: return c.entry_tick_time;
      case 7: return num(c.entry_spot);
      case 8: return c.exit_tick_time;
      case 9: return num(c.exit_spot);
      case 10: return c.barrier;
      case 11: return profit > 0 ? 'win' : 'loss';
      default: return undefined;
    }
  }

  private async eval(b: Element): Promise<Val> {
    this.guard();
    const type = b.getAttribute('type') ?? '';
    switch (type) {
      case 'math_number': return num(fieldText(b, 'NUM'));
      case 'text': return fieldText(b, 'TEXT');
      case 'logic_boolean': return fieldText(b, 'BOOL') === 'TRUE';
      case 'logic_null': return null;
      case 'variables_get': return this.vars.get(this.varKey(b));
      case 'math_arithmetic': {
        const a = num(await this.value(b, 'A')), c = num(await this.value(b, 'B'));
        switch (fieldText(b, 'OP')) { case 'ADD': return a + c; case 'MINUS': return a - c; case 'MULTIPLY': return a * c; case 'DIVIDE': return c === 0 ? 0 : a / c; case 'POWER': return a ** c; default: return 0; }
      }
      case 'math_single': case 'math_trig': case 'math_round': {
        const x = num(await this.value(b, 'NUM'));
        switch (fieldText(b, 'OP')) {
          case 'ABS': return Math.abs(x); case 'NEG': return -x; case 'ROOT': return Math.sqrt(x); case 'LN': return Math.log(x); case 'LOG10': return Math.log10(x);
          case 'EXP': return Math.exp(x); case 'POW10': return 10 ** x; case 'ROUND': return Math.round(x); case 'ROUNDUP': return Math.ceil(x); case 'ROUNDDOWN': return Math.floor(x);
          default: return x;
        }
      }
      case 'math_modulo': { const d = num(await this.value(b, 'DIVISOR')); return d ? num(await this.value(b, 'DIVIDEND')) % d : 0; }
      case 'math_constrain': return Math.min(Math.max(num(await this.value(b, 'VALUE')), num(await this.value(b, 'LOW'))), num(await this.value(b, 'HIGH')));
      case 'math_random_int': { const lo = num(await this.value(b, 'FROM')), hi = num(await this.value(b, 'TO')); return Math.floor(Math.random() * (hi - lo + 1)) + lo; }
      case 'math_random_float': return Math.random();
      case 'math_number_property': {
        const x = num(await this.value(b, 'NUMBER_TO_CHECK'));
        switch (fieldText(b, 'PROPERTY')) {
          case 'EVEN': return x % 2 === 0; case 'ODD': return Math.abs(x % 2) === 1; case 'WHOLE': return Number.isInteger(x);
          case 'POSITIVE': return x > 0; case 'NEGATIVE': return x < 0; case 'DIVISIBLE_BY': { const d = num(await this.value(b, 'DIVISOR')); return d ? x % d === 0 : false; }
          case 'PRIME': { if (x < 2 || !Number.isInteger(x)) return false; for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; }
          default: return false;
        }
      }
      case 'math_on_list': {
        const l = ((await this.value(b, 'LIST')) as number[] | undefined)?.map(num) ?? [];
        const sum = l.reduce((a, c) => a + c, 0);
        switch (fieldText(b, 'OP')) {
          case 'SUM': return sum; case 'MIN': return Math.min(...l); case 'MAX': return Math.max(...l); case 'AVERAGE': return l.length ? sum / l.length : 0;
          case 'MEDIAN': { const s = [...l].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; }
          default: return 0;
        }
      }
      case 'logic_compare': {
        const a = await this.value(b, 'A'), c = await this.value(b, 'B');
        const [x, y] = typeof a === 'number' || typeof c === 'number' ? [num(a), num(c)] : [a, c];
        switch (fieldText(b, 'OP')) {
          case 'EQ': return x == y; case 'NEQ': return x != y; // eslint-disable-line eqeqeq
          case 'LT': return (x as number) < (y as number); case 'LTE': return (x as number) <= (y as number);
          case 'GT': return (x as number) > (y as number); case 'GTE': return (x as number) >= (y as number);
          default: return false;
        }
      }
      case 'logic_operation': {
        const and = fieldText(b, 'OP') === 'AND';
        const a = truthy(await this.value(b, 'A'));
        if (and && !a) return false; if (!and && a) return true;
        return truthy(await this.value(b, 'B'));
      }
      case 'logic_negate': return !truthy(await this.value(b, 'BOOL'));
      case 'logic_ternary': return truthy(await this.value(b, 'IF')) ? this.value(b, 'THEN') : this.value(b, 'ELSE');
      case 'text_join': {
        const items = Number(kids(b).find((c) => c.tagName === 'mutation')?.getAttribute('items') ?? 0);
        let s = ''; for (let i = 0; i < items; i++) s += str(await this.value(b, `ADD${i}`)); return s;
      }
      case 'text_length': return str(await this.value(b, 'VALUE')).length;
      case 'text_isEmpty': return str(await this.value(b, 'VALUE')).length === 0;
      case 'lists_create_with': {
        const items = Number(kids(b).find((c) => c.tagName === 'mutation')?.getAttribute('items') ?? 0);
        const out: Val[] = []; for (let i = 0; i < items; i++) out.push(await this.value(b, `ADD${i}`)); return out;
      }
      case 'lists_length': return ((await this.value(b, 'VALUE')) as unknown[] | undefined)?.length ?? 0;
      case 'lists_getIndex': {
        const l = ((await this.value(b, 'VALUE')) as unknown[] | undefined) ?? [];
        const where = fieldText(b, 'WHERE'); const at = num(await this.value(b, 'AT'));
        const i = where === 'FIRST' ? 0 : where === 'LAST' ? l.length - 1 : where === 'FROM_END' ? l.length - at : where === 'RANDOM' ? Math.floor(Math.random() * l.length) : at - 1;
        return l[i];
      }
      case 'lists_getSublist': {
        const l = ((await this.value(b, 'LIST')) as unknown[] | undefined) ?? [];
        const idx = async (w: string, v: string) => { const n = num(await this.value(b, v)); return w === 'FIRST' ? 0 : w === 'LAST' ? l.length - 1 : w === 'FROM_END' ? l.length - n : n - 1; };
        return l.slice(await idx(fieldText(b, 'WHERE1'), 'AT1'), (await idx(fieldText(b, 'WHERE2'), 'AT2')) + 1);
      }
      // Market and account data.
      case 'tick': return this.ticks[this.ticks.length - 1];
      case 'tick_string': return this.ticks[this.ticks.length - 1]?.toFixed(this.decimals);
      case 'ticks': return [...this.ticks];
      case 'ticks_string': return this.ticks.map((t) => t.toFixed(this.decimals));
      case 'last_digit': return lastDigit(this.ticks[this.ticks.length - 1] ?? 0, this.decimals);
      case 'lastDigitList': return this.lastDigits();
      case 'check_direction': {
        const [a, c] = this.ticks.slice(-2); const dir = fieldText(b, 'CHECK_DIRECTION');
        return dir === 'rise' ? c > a : dir === 'fall' ? c < a : dir === 'still' ? c === a : false;
      }
      case 'get_ohlc': case 'ohlc': throw new Error('Candle blocks are not supported yet.');
      case 'balance': { const v = await this.h.balance(); return fieldText(b, 'BALANCE_TYPE') === 'STR' ? `${v.toFixed(2)} ${this.h.currency}` : v; }
      case 'total_profit': return Number(this.totalProfit.toFixed(2));
      case 'total_runs': return this.totalRuns;
      case 'read_details': return this.detail(num(fieldText(b, 'DETAIL_INDEX')));
      case 'contract_check_result': return (num(this.lastContract?.profit) > 0 ? 'win' : 'loss') === fieldText(b, 'CHECK_RESULT');
      case 'check_sell': return this.openContract?.is_valid_to_sell === 1;
      case 'sell_price': return num(this.openContract?.bid_price) - num(this.openContract?.buy_price);
      case 'procedures_callreturn': return this.call(b);
      case 'epoch': return Math.floor(Date.now() / 1000);
      default: throw new Error(`The "${type.replace(/_/g, ' ')}" block is not supported yet. The bot stopped before trading on it.`);
    }
  }
}
