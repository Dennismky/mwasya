import { useRef, useState } from 'react';
import type { useBotEngine } from './botEngine';

type Engine = ReturnType<typeof useBotEngine>;
type Tab = 'summary' | 'transactions' | 'journal';

/** Summary / Transactions / Journal: the same results panel on every page of the client site. */
export function RunPanel({ bot, currency, onCollapse }: { bot: Engine; currency: string; onCollapse: () => void }) {
  const [tab, setTab] = useState<Tab>('summary');
  const s = bot.summary;
  const running = bot.state !== 'idle';
  // Phones: drag the handle down (or tap it) to minimise the card into the floating Results button.
  // EDIT HERE: how far (px) the card must be dragged down before it minimises.
  const MINIMISE_AFTER = 70, TAP = 6;
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const place = (dy: number) => { if (sheet.current) sheet.current.style.transform = dy ? `translateY(${dy}px)` : ''; };
  const gripDown = (e: React.PointerEvent<HTMLButtonElement>) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, dy: 0 }; };
  const gripMove = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; d.dy = Math.max(0, e.clientY - d.y); place(d.dy); };
  const gripUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    place(0);
    if (d.dy >= MINIMISE_AFTER || d.dy < TAP) onCollapse();
  };
  return (
    <aside className="rp" aria-label="Results" ref={sheet}>
      <button className="rp-grip" aria-label="Minimise results" title="Drag down or tap to minimise" onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp}
        onPointerCancel={() => { drag.current = null; place(0); }} onClick={(e) => { if (e.detail === 0) onCollapse(); }}><span aria-hidden="true" /></button>
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
