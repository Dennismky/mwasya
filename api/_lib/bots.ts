import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isValid, riskLevel, validateSpec, type BotSpec, type Check } from '../../src/shared/botSpec.js';
import { requireOperator as requireOperatorRow } from './guard.js';
import { liveStrategies } from './strategies.js';

export interface BotRow {
  id: string;
  name: string;
  spec: BotSpec;
  risk: 'low' | 'medium' | 'high';
  status: 'draft' | 'published' | 'archived';
  created_at: string;
  updated_at: string;
}

export const BOT_COLUMNS = 'id, name, spec, risk, status, created_at, updated_at';
export const STATUSES = ['draft', 'published', 'archived'] as const;

/** Returns the active operator's id, or sends 401/403 and returns null (checked against the DB every call). */
export async function requireOperator(req: VercelRequest, res: VercelResponse): Promise<string | null> {
  const op = await requireOperatorRow(req, res);
  return op?.id ?? null;
}

/** Server-side gate: structural + Mwasya caps + Deriv's live strategy rules. */
export async function checkSpec(raw: unknown): Promise<{ spec: BotSpec; risk: BotRow['risk'] } | { checks: Check[] }> {
  if (!raw || typeof raw !== 'object' || JSON.stringify(raw).length > 4000) {
    return { checks: [{ severity: 'error', text: 'Invalid bot' }] };
  }
  const spec = raw as BotSpec;
  let strategies;
  try { strategies = await liveStrategies(); } catch { /* fall back to local rules; auto_start re-validates at run time */ }
  const checks = validateSpec(spec, strategies);
  if (!isValid(checks)) return { checks };
  return { spec: pick(spec), risk: riskLevel(spec.strategy) };
}

/** Rebuild the spec from known fields only, so no extra keys are stored. */
function pick(s: BotSpec): BotSpec {
  const c = s.contract, p = s.params;
  const contract: BotSpec['contract'] = { contract_type: c.contract_type, underlying_symbol: c.underlying_symbol, currency: c.currency };
  if (c.duration !== undefined) contract.duration = c.duration;
  if (c.duration_unit !== undefined) contract.duration_unit = c.duration_unit;
  if (c.barrier !== undefined) contract.barrier = c.barrier;
  if (c.growth_rate !== undefined) contract.growth_rate = c.growth_rate;
  const params: BotSpec['params'] = { initial_stake: p.initial_stake, take_profit: p.take_profit, stop_loss: p.stop_loss, max_contracts: p.max_contracts };
  if (s.strategy !== 'fixed' && p.max_stake !== undefined) params.max_stake = p.max_stake;
  if (s.strategy === 'martingale' && p.multiplier !== undefined) params.multiplier = p.multiplier;
  if (s.strategy === 'dalembert') params.unit = p.unit;
  return { version: 1, name: s.name.trim(), strategy: s.strategy, contract, params };
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
