/**
 * Bot Forge spec + safety validation. Shared by the browser (live feedback)
 * and the API (authoritative check before a bot is saved or published).
 *
 * A bot maps 1:1 onto Deriv's `auto_start` request:
 *   https://developers.deriv.com/llms/auto-start.md
 * Strategy parameter rules come from `auto_list_strategies` at runtime — the
 * docs example is wrong (money fields are strings, initial_stake is required).
 *
 * No imports: this file must run in both Vite and Vercel functions.
 */

export type Money = string; // Deriv wants money as decimal strings, e.g. "1.50"

export interface ContractTemplate {
  contract_type: string;
  underlying_symbol: string;
  currency: string;
  amount?: number;
  basis?: 'stake' | 'payout';
  duration?: number;
  duration_unit?: 'd' | 'm' | 's' | 'h' | 't';
  barrier?: string;
  growth_rate?: number;
}

/** Mwasya-level strategy ids. `fixed` = martingale with max_stake == initial_stake (no escalation). */
export type ForgeStrategy = 'fixed' | 'martingale' | 'dalembert';

export interface BotSpec {
  version: 1;
  name: string;
  strategy: ForgeStrategy;
  contract: ContractTemplate;
  params: {
    initial_stake: Money;
    take_profit: Money;
    stop_loss: Money;
    max_stake?: Money;
    max_contracts: number;
    multiplier?: number; // martingale
    unit?: Money; // dalembert
  };
}

/** Shape returned by Deriv `auto_list_strategies`. */
export interface DerivStrategy {
  strategy_id: string;
  display_name: string;
  description?: string;
  supported_contract_types: string[];
  parameters: {
    required?: string[];
    additionalProperties?: boolean;
    properties?: Record<string, { type?: string; exclusiveMinimum?: number; minimum?: number; maximum?: number }>;
  };
}

/** Mwasya platform caps — stricter than Deriv's, to protect traders. */
export const LIMITS = {
  maxContracts: 500,
  defaultMaxContracts: 50,
  maxStopLoss: 1000,
  maxMultiplier: 3, // Deriv allows up to 10
  maxStakeToStopLoss: 1, // a single stake may never exceed the stop loss
} as const;

export const CONTRACT_GROUPS: { label: string; types: { id: string; label: string }[] }[] = [
  { label: 'Rise/Fall', types: [{ id: 'CALL', label: 'Rise' }, { id: 'PUT', label: 'Fall' }] },
  { label: 'Digits', types: [
    { id: 'DIGITOVER', label: 'Digit Over' }, { id: 'DIGITUNDER', label: 'Digit Under' },
    { id: 'DIGITMATCH', label: 'Digit Matches' }, { id: 'DIGITDIFF', label: 'Digit Differs' },
    { id: 'DIGITEVEN', label: 'Even' }, { id: 'DIGITODD', label: 'Odd' },
  ] },
  { label: 'Asians', types: [{ id: 'ASIANU', label: 'Asian Up' }, { id: 'ASIAND', label: 'Asian Down' }] },
  { label: 'Accumulators', types: [{ id: 'ACCU', label: 'Accumulator' }] },
];

export const contractLabel = (id: string) =>
  CONTRACT_GROUPS.flatMap((g) => g.types).find((t) => t.id === id)?.label ?? id;

const DIGIT_BARRIER = new Set(['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF']);
const TICK_ONLY = new Set(['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF', 'DIGITEVEN', 'DIGITODD', 'ASIANU', 'ASIAND']);

export type Severity = 'error' | 'warning' | 'ok';
export interface Check { severity: Severity; field?: string; text: string }

const num = (v: unknown): number => (typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN);
const isMoney = (v: unknown) => typeof v === 'string' && /^\d{1,7}(\.\d{1,2})?$/.test(v) && Number(v) > 0;

/** Strategy actually sent to Deriv. */
export const derivStrategyId = (s: ForgeStrategy) => (s === 'fixed' ? 'martingale' : s);

/** Build the exact `auto_start` payload (without req_id / subscribe). */
export function toAutoStart(spec: BotSpec) {
  const p = spec.params;
  const params: Record<string, unknown> = {
    initial_stake: p.initial_stake,
    take_profit: p.take_profit,
    stop_loss: p.stop_loss,
    max_contracts: p.max_contracts,
  };
  if (spec.strategy === 'fixed') {
    params.max_stake = p.initial_stake; // cap == start → stake never grows
  } else {
    if (p.max_stake) params.max_stake = p.max_stake;
    if (spec.strategy === 'martingale' && p.multiplier !== undefined) params.multiplier = p.multiplier;
    if (spec.strategy === 'dalembert') params.unit = p.unit;
  }
  return {
    auto_start: 1 as const,
    strategy_id: derivStrategyId(spec.strategy),
    strategy_parameters: params,
    contract_template: { ...spec.contract, amount: Number(p.initial_stake), basis: 'stake' as const },
  };
}

/** Minimal JSON-schema check of strategy_parameters against Deriv's live schema. */
function checkAgainstDeriv(params: Record<string, unknown>, s: DerivStrategy): Check[] {
  const out: Check[] = [];
  const props = s.parameters.properties ?? {};
  for (const r of s.parameters.required ?? []) {
    if (params[r] === undefined || params[r] === '') out.push({ severity: 'error', field: r, text: `${r} is required by Deriv` });
  }
  for (const [k, v] of Object.entries(params)) {
    const def = props[k];
    if (!def) {
      if (s.parameters.additionalProperties === false) out.push({ severity: 'error', field: k, text: `Deriv does not accept ${k} for ${s.display_name}` });
      continue;
    }
    if (def.type === 'string' && typeof v !== 'string') out.push({ severity: 'error', field: k, text: `${k} must be a string` });
    if ((def.type === 'number' || def.type === 'integer') && typeof v !== 'number') out.push({ severity: 'error', field: k, text: `${k} must be a number` });
    if (def.type === 'integer' && typeof v === 'number' && !Number.isInteger(v)) out.push({ severity: 'error', field: k, text: `${k} must be a whole number` });
    if (typeof v === 'number') {
      if (def.exclusiveMinimum !== undefined && !(v > def.exclusiveMinimum)) out.push({ severity: 'error', field: k, text: `${k} must be more than ${def.exclusiveMinimum}` });
      if (def.minimum !== undefined && v < def.minimum) out.push({ severity: 'error', field: k, text: `${k} must be at least ${def.minimum}` });
      if (def.maximum !== undefined && v > def.maximum) out.push({ severity: 'error', field: k, text: `${k} must be at most ${def.maximum}` });
    }
  }
  return out;
}

/**
 * Full safety review. `strategies` = live `auto_list_strategies` result;
 * pass it whenever available (server always does).
 */
export function validateSpec(spec: BotSpec, strategies?: DerivStrategy[]): Check[] {
  const c: Check[] = [];
  const err = (field: string, text: string) => c.push({ severity: 'error', field, text });
  const p = spec.params ?? ({} as BotSpec['params']);
  const k = spec.contract ?? ({} as ContractTemplate);

  if (spec.version !== 1) err('version', 'Unsupported bot version');
  if (typeof spec.name !== 'string' || !spec.name.trim() || spec.name.length > 80) err('name', 'Give the bot a name (up to 80 characters)');
  if (!['fixed', 'martingale', 'dalembert'].includes(spec.strategy)) err('strategy', 'Unknown strategy');

  // Contract
  if (!/^[A-Z]{2,20}$/.test(k.contract_type ?? '')) err('contract_type', 'Pick a contract type');
  if (!/^\w{2,30}$/.test(k.underlying_symbol ?? '')) err('underlying_symbol', 'Pick a market');
  if (!/^[a-zA-Z0-9]{2,20}$/.test(k.currency ?? '')) err('currency', 'Currency is missing');
  if (DIGIT_BARRIER.has(k.contract_type)) {
    const d = Number(k.barrier);
    const lo = k.contract_type === 'DIGITUNDER' ? 1 : 0;
    const hi = k.contract_type === 'DIGITOVER' ? 8 : 9;
    if (!/^\d$/.test(k.barrier ?? '') || d < lo || d > hi) err('barrier', `Pick a digit from ${lo} to ${hi}`);
  }
  if (k.contract_type === 'ACCU') {
    if (k.growth_rate === undefined || ![0.01, 0.02, 0.03, 0.04, 0.05].includes(k.growth_rate)) err('growth_rate', 'Growth rate must be 1% to 5%');
    if (k.duration !== undefined) err('duration', 'Accumulators have no duration');
  } else {
    if (!Number.isInteger(k.duration) || (k.duration ?? 0) < 1) err('duration', 'Set a duration');
    if (TICK_ONLY.has(k.contract_type)) {
      if (k.duration_unit !== 't') err('duration_unit', 'This contract runs in ticks');
      if ((k.duration ?? 0) > 10) err('duration', 'Tick contracts last 1 to 10 ticks');
      if (k.contract_type.startsWith('ASIAN') && (k.duration ?? 0) < 5) err('duration', 'Asians need at least 5 ticks');
    }
  }

  // Money + limits
  for (const f of ['initial_stake', 'take_profit', 'stop_loss'] as const) {
    if (!isMoney(p[f])) err(f, `${f.replace('_', ' ')} must be a positive amount (max 2 decimals)`);
  }
  const stake = num(p.initial_stake), sl = num(p.stop_loss);
  if (sl > LIMITS.maxStopLoss) err('stop_loss', `Stop loss is capped at ${LIMITS.maxStopLoss}`);
  if (stake > sl * LIMITS.maxStakeToStopLoss) err('initial_stake', 'Stake cannot be bigger than the stop loss');
  if (!Number.isInteger(p.max_contracts) || p.max_contracts < 1 || p.max_contracts > LIMITS.maxContracts) {
    err('max_contracts', `Max trades must be 1 to ${LIMITS.maxContracts}`);
  }

  if (spec.strategy === 'martingale' || spec.strategy === 'dalembert') {
    if (!isMoney(p.max_stake)) err('max_stake', 'Escalating strategies must have a max stake');
    else {
      const ms = num(p.max_stake);
      if (ms < stake) err('max_stake', 'Max stake must be at least the starting stake');
      if (ms > sl) err('max_stake', 'Max stake cannot exceed the stop loss');
    }
  }
  if (spec.strategy === 'martingale') {
    const m = p.multiplier ?? 2;
    if (!(m > 1) || m > LIMITS.maxMultiplier) err('multiplier', `Multiplier must be above 1 and at most ${LIMITS.maxMultiplier}`);
  }
  if (spec.strategy === 'dalembert' && !isMoney(p.unit)) err('unit', 'Set the step amount');

  // Deriv's own rules (live)
  if (strategies) {
    const ds = strategies.find((s) => s.strategy_id === derivStrategyId(spec.strategy));
    if (!ds) err('strategy', 'Deriv no longer offers this strategy');
    else {
      if (!ds.supported_contract_types.includes(k.contract_type)) err('contract_type', `${ds.display_name} does not support ${contractLabel(k.contract_type)}`);
      if (!c.some((x) => x.severity === 'error')) c.push(...checkAgainstDeriv(toAutoStart(spec).strategy_parameters, ds));
    }
  }

  // Positive confirmations + risk warnings (shown in the "Safety checks" card)
  if (!c.some((x) => x.severity === 'error')) {
    c.push({ severity: 'ok', text: `Stop loss set (${p.stop_loss} ${k.currency})` });
    c.push({ severity: 'ok', text: `Stops after ${p.max_contracts} trades at most` });
    if (spec.strategy === 'fixed') c.push({ severity: 'ok', text: 'Fixed stake, no escalation' });
    if (spec.strategy === 'martingale') c.push({ severity: 'warning', text: `High risk: martingale multiplies the stake by ${p.multiplier ?? 2} after each loss. Capped at ${p.max_stake}.` });
    if (spec.strategy === 'dalembert') c.push({ severity: 'warning', text: `Medium risk: stake rises by ${p.unit} after each loss. Capped at ${p.max_stake}.` });
    if (strategies) c.push({ severity: 'ok', text: 'Matches Deriv\'s live strategy rules' });
  }
  return c;
}

export const isValid = (checks: Check[]) => !checks.some((c) => c.severity === 'error');
export const riskLevel = (s: ForgeStrategy) => (s === 'martingale' ? 'high' : s === 'dalembert' ? 'medium' : 'low');

export function defaultSpec(): BotSpec {
  return {
    version: 1,
    name: 'Digit Over 3 · Volatility 100 (1s)',
    strategy: 'fixed',
    contract: { contract_type: 'DIGITOVER', barrier: '3', underlying_symbol: '1HZ100V', currency: 'USD', duration: 1, duration_unit: 't' },
    params: { initial_stake: '1', take_profit: '5', stop_loss: '20', max_contracts: LIMITS.defaultMaxContracts },
  };
}

export const TEMPLATES: { label: string; spec: BotSpec }[] = [
  { label: 'Digit Over 3', spec: defaultSpec() },
  { label: 'Even', spec: { version: 1, name: 'Even · Volatility 75', strategy: 'fixed',
    contract: { contract_type: 'DIGITEVEN', underlying_symbol: 'R_75', currency: 'USD', duration: 1, duration_unit: 't' },
    params: { initial_stake: '0.5', take_profit: '3', stop_loss: '10', max_contracts: 50 } } },
  { label: 'Rise 5 ticks', spec: { version: 1, name: 'Rise · Volatility 100', strategy: 'fixed',
    contract: { contract_type: 'CALL', underlying_symbol: 'R_100', currency: 'USD', duration: 5, duration_unit: 't' },
    params: { initial_stake: '2', take_profit: '10', stop_loss: '15', max_contracts: 30 } } },
  { label: 'Martingale', spec: { version: 1, name: 'Digit Under 6 · Martingale', strategy: 'martingale',
    contract: { contract_type: 'DIGITUNDER', barrier: '6', underlying_symbol: 'R_10', currency: 'USD', duration: 1, duration_unit: 't' },
    params: { initial_stake: '1', take_profit: '5', stop_loss: '25', max_stake: '16', multiplier: 2, max_contracts: 50 } } },
];
