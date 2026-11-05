import { useState } from 'react';
import type { useBotEngine } from './botEngine';

type Engine = ReturnType<typeof useBotEngine>;
type Tab = 'summary' | 'transactions' | 'journal';

/** Summary / Transactions / Journal: the same results panel on every page of the client site. */
export function RunPanel({ bot, currency, onCollapse }: { bot: Engine; currency: string; onCollapse: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const s = bot.summary;
  const running = bot.state !== 'idle';
  return (
    <aside className="rp" aria-label="Results">
      <button className="rp-collapse" aria-label="Hide results panel" title="Hide" onClick={onCollapse}>»</button>
      <div className="bw-tabs" role="tablist">
        {(['summary', 'transactions', 'journal'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={tab === p} className={tab === p ? 'on' : ''} onClick={() => setTab(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
        ))}
      </div>
      <div className="bw-body">
        {tab === 'summary' && (s.runs === 0
          ? <p className="bw-empty">When you're ready to trade, hit <b>Run</b> or buy a contract. You can follow every result here.</p>
          : (
            <div className="rp-sum">
              <div className={`rp-pnl ${s.pnl > 0 ? 'up' : s.pnl < 0 ? 'down' : ''}`}><small>Total profit/loss</small><b className="mono">{s.pnl >= 0 ? '+' : '-'}{Math.abs(s.pnl).toFixed(2)} {currency}</b></div>
              <div className="rp-bar"><span className="w" style={{ flex: s.won || 0.0001 }} /><span className="l" style={{ flex: s.lost || 0.0001 }} /></div>
              <div className="rp-wl"><span>{s.won} won</span><span>{s.lost} lost</span></div>
              {running && <p className="hint" style={{ textAlign: 'center' }}><span className="bb-pulse" style={{ display: 'inline-block', background: '#12A07A' }} /> Bot running</p>}
            </div>
          ))}
        {tab === 'transactions' && (bot.trades.length === 0 ? <p className="bw-empty">There are no transactions to display yet.</p> : (
          <ul className="bb-list">
            {bot.trades.map((t) => (
              <li key={t.id} className={`bb-tx ${t.status}`}>
                <span className="bb-dot" />
                <span className="stack" style={{ minWidth: 0 }}><b>{t.type}</b><small className="mono hint">{t.entry ? `${t.entry} → ${t.exit ?? '…'}` : `#${t.id}`}</small></span>
                <span className="stack" style={{ alignItems: 'flex-end' }}><small className="mono">{t.stake.toFixed(2)}</small>
                  <b className="mono">{t.status === 'open' ? '…' : `${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}`}</b></span>
              </li>
            ))}
          </ul>
        ))}
        {tab === 'journal' && (bot.journal.length === 0 ? <p className="bw-empty">Every executed trade and every bot step is logged here.</p> : (
          <ul className="bb-list bb-journal">
            {bot.journal.map((j, i) => (
              <li key={i} className={`bb-j ${j.level}`}><small className="mono">{new Date(j.t).toLocaleTimeString()}</small><span>{j.text}</span></li>
            ))}
          </ul>
        ))}
      </div>
      <div className="bw-stats">
        <Stat k="Total stake" v={`${s.stake.toFixed(2)} ${currency}`} />
        <Stat k="Total payout" v={`${s.payout.toFixed(2)} ${currency}`} />
        <Stat k="No. of runs" v={String(s.runs)} />
        <Stat k="Contracts lost" v={String(s.lost)} tone={s.lost ? 'bad' : undefined} />
        <Stat k="Contracts won" v={String(s.won)} tone={s.won ? 'ok' : undefined} />
        <Stat k="Total profit/loss" v={`${s.pnl >= 0 ? '' : '-'}${Math.abs(s.pnl).toFixed(2)} ${currency}`} tone={s.pnl > 0 ? 'ok' : s.pnl < 0 ? 'bad' : undefined} />
      </div>
      <button className="bw-reset" disabled={running} onClick={bot.reset}>Reset results</button>
    </aside>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  return <div className="bw-stat"><small>{k}</small><b className="mono" style={{ color: tone === 'ok' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : undefined }}>{v}</b></div>;
}
