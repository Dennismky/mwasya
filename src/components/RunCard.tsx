import { runPnL, type AutoRun } from '../lib/autoTrade';
import { contractLabel, marketLabel } from '../shared/botSpec';

/** Live view of one Deriv auto-run: status, P/L, recent trades (stake → payout) and controls. */
export function RunCard({ run, currency, compact, onPause, onResume, onStop }: {
  run: AutoRun; currency: string; compact?: boolean;
  onPause: () => void; onResume: () => void; onStop: () => void;
}) {
  const pnl = runPnL(run);
  const contracts = [...(run.contracts ?? [])].sort((a, b) => a.purchase_time - b.purchase_time);
  const won = contracts.filter((c) => c.contract_status === 'won').length;
  const lost = contracts.filter((c) => c.contract_status === 'lost').length;
  const t = run.contract_template as { contract_type?: string; underlying_symbol?: string; barrier?: string };
  const recent = contracts.slice(-12);
  return (
    <article className="stack" style={{ gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <b>{contractLabel(t.contract_type ?? '')}{t.barrier ? ` ${t.barrier}` : ''} · {marketLabel(t.underlying_symbol ?? '')}</b>
        <span className={`badge ${run.status === 'running' ? 'badge-green' : 'badge-blue'}`}>{run.status}</span>
        {!compact && <span className="hint mono">{run.run_id}</span>}
        <span style={{ flex: 1 }} />
        <b className="mono" style={{ color: pnl > 0 ? 'var(--success)' : pnl < 0 ? 'var(--danger)' : undefined }}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} {currency}</b>
        {run.status === 'running' && <button className="btn btn-secondary" onClick={onPause}>Pause</button>}
        {run.status === 'paused' && <button className="btn btn-secondary" onClick={onResume}>Resume</button>}
        {run.status !== 'stopped' && <button className="btn btn-secondary" onClick={onStop}>Stop</button>}
      </div>
      <span className="hint">
        {contracts.length} trades · {won} won · {lost} lost · staked {(run.total_stake ?? 0).toFixed(2)} · paid out {(run.total_payout ?? 0).toFixed(2)} {currency}
        {run.stop_reason && ` · stopped: ${run.stop_reason.replace('_', ' ')}${run.stop_reason_code ? ` (${run.stop_reason_code})` : ''}`}
      </span>
      {recent.length > 0 && (
        <div className="row" style={{ gap: 6 }} aria-label="Recent trades: stake and payout">
          {recent.map((c) => {
            const settled = c.contract_status === 'won' || c.contract_status === 'lost';
            const payout = settled ? (c.sell_price ?? 0) : undefined;
            const profit = payout !== undefined ? payout - c.buy_price : undefined;
            return (
              <span key={c.contract_id} className="mono"
                title={`Contract ${c.contract_id} · stake ${c.buy_price.toFixed(2)}${payout !== undefined ? ` · payout ${payout.toFixed(2)} · ${profit! >= 0 ? '+' : ''}${profit!.toFixed(2)} ${currency}` : ' · open'}`}
                style={{
                  fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)',
                  background: c.contract_status === 'won' ? 'var(--success-tint)' : c.contract_status === 'lost' ? 'var(--danger-tint)' : '#fff',
                }}>
                {c.buy_price.toFixed(2)} → {payout !== undefined ? payout.toFixed(2) : '…'}
              </span>
            );
          })}
        </div>
      )}
    </article>
  );
}
