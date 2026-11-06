import { useEffect, useState } from 'react';
import { InfoTip, TIPS } from '../components/InfoTip';
import type { BotConfig } from './botEngine';
import { BOT_MARKETS } from './market';

/**
 * The strategy settings a client fills in: market, contract, digit, ticks, entry, stake, martingale, limits.
 * Used by Bot Builder's ⚡ Quick strategy (builds blocks) and by Quick Bot's "Create your bot" (runs straight away).
 */

// EDIT HERE: contract types offered when a client creates a bot.
export const CONTRACTS: { id: BotConfig['contract']; label: string; digit?: boolean }[] = [
  { id: 'DIGITOVER', label: 'Over', digit: true }, { id: 'DIGITUNDER', label: 'Under', digit: true },
  { id: 'DIGITMATCH', label: 'Matches', digit: true }, { id: 'DIGITDIFF', label: 'Differs', digit: true },
  { id: 'DIGITEVEN', label: 'Even' }, { id: 'DIGITODD', label: 'Odd' },
  { id: 'CALL', label: 'Rise' }, { id: 'PUT', label: 'Fall' },
];
export const contractName = (c: BotConfig) => `${CONTRACTS.find((x) => x.id === c.contract)?.label ?? c.contract}${CONTRACTS.find((x) => x.id === c.contract)?.digit ? ` ${c.prediction}` : ''}`;
const num = (v: string, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Anything that stops these settings from running (first item is shown). */
export function strategyProblems(cfg: BotConfig): string[] {
  const p: string[] = [];
  if (!(cfg.stake >= 0.35)) p.push('Stake must be at least 0.35');
  if (cfg.contract === 'DIGITOVER' && cfg.prediction > 8) p.push('Over needs a digit from 0 to 8');
  if (cfg.contract === 'DIGITUNDER' && cfg.prediction < 1) p.push('Under needs a digit from 1 to 9');
  if (!(cfg.stopLoss > 0)) p.push('Set a stop loss');
  if (cfg.recovery && !(cfg.multiplier > 0 && cfg.multiplier <= 5)) p.push('Recovery factor must be above 0 and at most 5');
  if (cfg.recovery && cfg.maxStake > 0 && cfg.maxStake < cfg.stake) p.push('Max stake must be at least the stake');
  return p;
}

/** The four steps. `market` hides the market picker when the page already has one. */
export function StrategyFields({ cfg, setCfg, currency, market = true, disabled = false }: {
  cfg: BotConfig; setCfg: (f: (c: BotConfig) => BotConfig) => void; currency: string; market?: boolean; disabled?: boolean;
}) {
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const isDigit = CONTRACTS.find((c) => c.id === cfg.contract)?.digit ?? false;
  const addMode = cfg.recoveryMode === 'add';
  return (
    <fieldset className="sf" disabled={disabled}>
      <section className="qs-step"><header><span>1</span><b>{market ? 'Market & contract' : 'Contract'}</b></header>
        {market && (
          <select className="input" value={cfg.symbol} onChange={(e) => set('symbol', e.target.value)} aria-label="Market">
            {BOT_MARKETS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div className="seg bb-seg">{CONTRACTS.map((c) => <button type="button" key={c.id} className={cfg.contract === c.id ? 'on' : ''} onClick={() => set('contract', c.id)}>{c.label}</button>)}</div>
        {isDigit && <div className="digits">{Array.from({ length: 10 }, (_, d) => <button type="button" key={d} className={cfg.prediction === d ? 'on' : ''} onClick={() => set('prediction', d)}>{d}</button>)}</div>}
        <label className="label">Duration: {cfg.ticks} tick{cfg.ticks === 1 ? '' : 's'} <InfoTip>{TIPS.duration}</InfoTip></label>
        <input type="range" min={1} max={10} value={cfg.ticks} onChange={(e) => set('ticks', Number(e.target.value))} aria-label="Ticks" />
      </section>
      <section className="qs-step"><header><span>2</span><b>Entry</b></header>
        <label className="bb-check"><input type="checkbox" checked={cfg.entryDigit === null} onChange={(e) => set('entryDigit', e.target.checked ? null : 5)} /> Buy straight away</label>
        {cfg.entryDigit !== null && <>
          <span className="hint">Buy right after a tick ending in:</span>
          <div className="digits">{Array.from({ length: 10 }, (_, d) => <button type="button" key={d} className={cfg.entryDigit === d ? 'on' : ''} onClick={() => set('entryDigit', d)}>{d}</button>)}</div>
        </>}
      </section>
      <section className="qs-step"><header><span>3</span><b>Stake & recovery</b></header>
        <Field id="sf-stake" label="Initial stake" tip={TIPS.stake} value={cfg.stake} suffix={currency} onChange={(v) => set('stake', num(v))} />
        <label className="bb-check"><input type="checkbox" checked={cfg.recovery} onChange={(e) => set('recovery', e.target.checked)} /> Raise the stake after a loss (martingale)</label>
        {cfg.recovery && (
          <>
            <div className="seg"><button type="button" className={!addMode ? 'on' : ''} onClick={() => setCfg((c) => ({ ...c, recoveryMode: 'multiply', multiplier: c.multiplier > 1 ? c.multiplier : 2 }))}>Martingale</button><button type="button" className={addMode ? 'on' : ''} onClick={() => set('recoveryMode', 'add')}>Add the loss</button></div>
            <div className="bb-row">
              <Field id="sf-mult" label={addMode ? 'Next stake + loss ×' : 'Multiply by'} value={cfg.multiplier} suffix="×" onChange={(v) => set('multiplier', num(v, 2))} />
              <Field id="sf-max" label="Max stake" value={cfg.maxStake} suffix={currency} onChange={(v) => set('maxStake', num(v))} />
            </div>
          </>
        )}
      </section>
      <section className="qs-step"><header><span>4</span><b>Limits</b></header>
        <div className="bb-row">
          <Field id="sf-tp" label="Take profit" tip={TIPS.takeProfit} value={cfg.takeProfit} suffix={currency} onChange={(v) => set('takeProfit', num(v))} />
          <Field id="sf-sl" label="Stop loss" tip={TIPS.stopLoss} value={cfg.stopLoss} suffix={currency} onChange={(v) => set('stopLoss', num(v))} />
        </div>
      </section>
    </fieldset>
  );
}

export function Field({ id, label, value, onChange, suffix, tip }: { id: string; label: string; value: number; onChange: (v: string) => void; suffix?: string; tip?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="field" style={{ flex: 1, minWidth: 130 }}>
      <label className="label" htmlFor={id}>{label}{tip && <InfoTip>{tip}</InfoTip>}</label>
      <div className="input-group">
        <input id={id} className="input mono" inputMode="decimal" value={text} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setText(v); onChange(v); }} />
        {suffix && <span className="addon">{suffix}</span>}
      </div>
    </div>
  );
}
