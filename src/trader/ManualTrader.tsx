import { useEffect, useMemo, useRef, useState } from 'react';
import { InfoTip, TIPS } from '../components/InfoTip';
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { accountSocket, publicSocket, type DerivSocket } from '../lib/derivWs';
import { useOffer } from './contracts';
import { useTrader } from './TraderApp';
import type { ChartLine } from './TickChart';
import { LiveChart } from './LiveChart';
import { SYMBOLS, decimalsOf, symbolName, useTicks } from './ticks';

type Kind = 'risefall' | 'higherlower' | 'touch' | 'overunder' | 'evenodd' | 'matchdiff' | 'accu' | 'multipliers';
const KINDS: { id: Kind; label: string; needs: string }[] = [
  { id: 'risefall', label: 'Rise/Fall', needs: 'CALL' },
  { id: 'higherlower', label: 'Higher/Lower', needs: 'HIGHER' },
  { id: 'touch', label: 'Touch', needs: 'ONETOUCH' },
  { id: 'overunder', label: 'Over/Under', needs: 'DIGITOVER' },
  { id: 'evenodd', label: 'Even/Odd', needs: 'DIGITEVEN' },
  { id: 'matchdiff', label: 'Matches', needs: 'DIGITMATCH' },
  { id: 'accu', label: 'Accumulators', needs: 'ACCU' },
  { id: 'multipliers', label: 'Multipliers', needs: 'MULTUP' },
];
const SIDES: Record<Kind, { type: string; label: string; tone: 'up' | 'down' }[]> = {
  risefall: [{ type: 'CALL', label: 'Rise', tone: 'up' }, { type: 'PUT', label: 'Fall', tone: 'down' }],
  higherlower: [{ type: 'HIGHER', label: 'Higher', tone: 'up' }, { type: 'LOWER', label: 'Lower', tone: 'down' }],
  touch: [{ type: 'ONETOUCH', label: 'Touch', tone: 'up' }, { type: 'NOTOUCH', label: 'No Touch', tone: 'down' }],
  overunder: [{ type: 'DIGITOVER', label: 'Over', tone: 'up' }, { type: 'DIGITUNDER', label: 'Under', tone: 'down' }],
  evenodd: [{ type: 'DIGITEVEN', label: 'Even', tone: 'up' }, { type: 'DIGITODD', label: 'Odd', tone: 'down' }],
  matchdiff: [{ type: 'DIGITMATCH', label: 'Matches', tone: 'up' }, { type: 'DIGITDIFF', label: 'Differs', tone: 'down' }],
  accu: [{ type: 'ACCU', label: 'Buy', tone: 'up' }],
  multipliers: [{ type: 'MULTUP', label: 'Up', tone: 'up' }, { type: 'MULTDOWN', label: 'Down', tone: 'down' }],
};
const SELLABLE = new Set(['ACCU', 'MULTUP', 'MULTDOWN']);
const usesTicks = (k: Kind) => !['accu', 'multipliers'].includes(k);
const usesBarrier = (k: Kind) => k === 'higherlower' || k === 'touch';

interface Quote { id: string; ask: number; payout: number; error?: string; high?: number; low?: number; maxTicks?: number; maxPayout?: number; stopOut?: number; barrier?: number; stayed?: number[] }
interface OpenC {
  id: number; type: string; symbol: string; buy: number; status: string; profit: number; bid?: number; sold: boolean;
  validToSell: boolean; entry?: number; exit?: number; high?: number; low?: number; ticks?: number; longcode?: string;
}

export default function ManualTrader() {
  const auth = useAuth();
  const { bot: journal } = useTrader();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const isPreview = account?.id === PREVIEW_ACCOUNT_ID;
  const [symbol, setSymbol] = useState('1HZ100V');
  const [kind, setKind] = useState<Kind>('risefall');
  const [stake, setStake] = useState('10');
  const [ticks, setTicks] = useState(5);
  const [digit, setDigit] = useState(5);
  const [barrier, setBarrier] = useState('+0.30');
  const [growth, setGrowth] = useState(0.03);
  const [mult, setMult] = useState(100);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [useTp, setUseTp] = useState(false);
  const [picker, setPicker] = useState(false);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [contracts, setContracts] = useState<OpenC[]>([]);
  const [nonce, setNonce] = useState(0);
  const ws = useRef<DerivSocket | null>(null);
  const watchers = useRef(new Map<number, () => void>());

  const { prices, times } = useTicks(symbol, 240);
  const decimals = useMemo(() => decimalsOf(prices), [prices.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const offer = useOffer(symbol);

  // Only trade types Deriv offers on this market; fall back to the first available one.
  const kinds = useMemo(() => (offer ? KINDS.filter((k) => offer.types.has(k.needs)) : KINDS), [offer]);
  useEffect(() => { if (offer && !kinds.some((k) => k.id === kind)) setKind(kinds[0]?.id ?? 'risefall'); }, [offer, kinds, kind]);
  // Tick range allowed for the chosen type on this market.
  const range = offer?.ticks[SIDES[kind][0].type] ?? { min: 1, max: 10 };
  useEffect(() => { if (usesTicks(kind)) setTicks((t) => Math.min(range.max, Math.max(range.min, t))); }, [kind, range.min, range.max]);
  const mults = offer?.multipliers.length ? offer.multipliers : [40, 100, 200, 300, 400];
  useEffect(() => { if (!mults.includes(mult)) setMult(mults[Math.min(1, mults.length - 1)]); }, [mults, mult]);

  // Private trading socket for the selected account (preview: public quotes only).
  useEffect(() => {
    if (!account?.id) return;
    const s = account.id === PREVIEW_ACCOUNT_ID ? publicSocket() : accountSocket(account.id);
    ws.current = s;
    const w = watchers.current;
    return () => { w.forEach((u) => u()); w.clear(); s.close(); ws.current = null; };
  }, [account?.id]);

  // Live price quotes (re-quoted when anything changes, and after each buy).
  useEffect(() => {
    const s = ws.current;
    if (!s || !account) return;
    const amount = Number(stake);
    setQuotes({});
    if (!(amount > 0)) return;
    if (usesBarrier(kind) && !/^[+-]\d+(\.\d+)?$/.test(barrier)) return;
    let alive = true;
    const offs: (() => void)[] = [];
    const t = setTimeout(() => {
      for (const side of SIDES[kind]) {
        const req: Record<string, unknown> = { proposal: 1, amount, basis: 'stake', contract_type: side.type, currency, underlying_symbol: symbol };
        if (kind === 'accu') {
          req.growth_rate = growth;
          if (useTp && Number(tp) > 0) req.limit_order = { take_profit: Number(tp) };
        } else if (kind === 'multipliers') {
          req.multiplier = mult;
          const lo: Record<string, number> = {};
          if (useTp && Number(tp) > 0) lo.take_profit = Number(tp);
          if (Number(sl) > 0) lo.stop_loss = Number(sl);
          if (Object.keys(lo).length) req.limit_order = lo;
        } else { req.duration = ticks; req.duration_unit = 't'; }
        if (kind === 'overunder' || kind === 'matchdiff') req.barrier = String(side.type === 'DIGITUNDER' ? Math.max(1, digit) : side.type === 'DIGITOVER' ? Math.min(8, digit) : digit);
        if (usesBarrier(kind)) req.barrier = barrier;
        s.subscribe(req, (m) => {
          if (!alive) return;
          const err = m.error as { message?: string } | undefined;
          if (err) return setQuotes((q) => ({ ...q, [side.type]: { id: '', ask: 0, payout: 0, error: err.message } }));
          const p = m.proposal as {
            id: string; ask_price: number; payout: number;
            contract_details?: { high_barrier?: string; low_barrier?: string; maximum_ticks?: number; maximum_payout?: number; barrier?: string; ticks_stayed_in?: number[] };
            limit_order?: { stop_out?: { value?: string } };
          } | undefined;
          if (p) setQuotes((q) => ({ ...q, [side.type]: {
            id: p.id, ask: p.ask_price, payout: p.payout,
            high: p.contract_details?.high_barrier ? Number(p.contract_details.high_barrier) : undefined,
            low: p.contract_details?.low_barrier ? Number(p.contract_details.low_barrier) : undefined,
            maxTicks: p.contract_details?.maximum_ticks, maxPayout: p.contract_details?.maximum_payout,
            barrier: p.contract_details?.barrier ? Number(p.contract_details.barrier) : undefined,
            stopOut: p.limit_order?.stop_out?.value ? Number(p.limit_order.stop_out.value) : undefined,
            stayed: p.contract_details?.ticks_stayed_in,
          } }));
        }).then((u) => (alive ? offs.push(u) : u())).catch((e: Error) => { if (e.message === 'SESSION_EXPIRED') auth.expire(); });
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); offs.forEach((u) => u()); };
  }, [symbol, kind, stake, ticks, digit, barrier, growth, mult, tp, sl, useTp, currency, account?.id, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const watch = (id: number) => {
    const s = ws.current;
    if (!s || watchers.current.has(id)) return;
    s.subscribe({ proposal_open_contract: 1, contract_id: id }, (m) => {
      const c = m.proposal_open_contract as Record<string, unknown> | undefined;
      if (!c || typeof c.contract_id !== 'number') return;
      const n = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
      const sold = c.is_sold === 1;
      setContracts((list) => list.map((x) => (x.id !== c.contract_id ? x : {
        ...x, status: String(c.status ?? 'open'), profit: n(c.profit) ?? x.profit, bid: n(c.bid_price), sold,
        validToSell: c.is_valid_to_sell === 1 && !sold, entry: n(c.entry_spot) ?? x.entry, exit: n(c.exit_spot),
        high: n(c.high_barrier) ?? x.high, low: n(c.low_barrier) ?? x.low, ticks: n(c.tick_passed) ?? n(c.tick_count), longcode: String(c.longcode ?? x.longcode ?? ''),
      })));
      if (sold) { watchers.current.get(id)?.(); watchers.current.delete(id); auth.refreshBalance(); journal.recordSettle({ id, profit: n(c.profit) ?? 0, source: 'Manual', entry: n(c.entry_spot), exit: n(c.exit_spot) }); }
    }).then((u) => watchers.current.set(id, u)).catch(() => undefined);
  };

  const buy = async (type: string) => {
    const s = ws.current, q = quotes[type];
    if (!s || !q?.id || !account) return;
    if (!account.isVirtual && !confirm(`Buy ${type} for ${q.ask.toFixed(2)} ${currency} on your REAL account?`)) return;
    setBuying(type); setError('');
    try {
      const r = await s.send<{ buy: { contract_id: number; buy_price: number; longcode?: string } }>({ buy: q.id, price: q.ask });
      setContracts((l) => [{ id: r.buy.contract_id, type, symbol, buy: r.buy.buy_price, status: 'open', profit: 0, sold: false, validToSell: false, longcode: r.buy.longcode }, ...l].slice(0, 20));
      watch(r.buy.contract_id);
      journal.recordBuy({ id: r.buy.contract_id, type, stake: r.buy.buy_price, payout: q.payout, source: 'Manual' });
      auth.refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuying(null);
      setNonce((n) => n + 1);
    }
  };

  const sell = async (id: number) => {
    try { await ws.current?.send({ sell: id, price: 0 }); } catch (e) { setError((e as Error).message); }
  };

  const open = contracts.find((c) => !c.sold && c.symbol === symbol);
  const lines: ChartLine[] = [];
  if (open?.entry) lines.push({ value: open.entry, label: 'Entry', color: 'var(--primary)', dashed: true });
  const accuQuote = kind === 'accu' ? quotes.ACCU : undefined;
  const hi = open?.high ?? accuQuote?.high, lo = open?.low ?? accuQuote?.low;
  if ((open?.type === 'ACCU' || kind === 'accu') && hi && lo) lines.push({ value: hi, label: 'High', color: '#3D8BFD', dashed: true }, { value: lo, label: 'Low', color: '#3D8BFD', dashed: true });
  const firstQuote = quotes[SIDES[kind][0].type];
  if (usesBarrier(kind) && firstQuote?.barrier) lines.push({ value: firstQuote.barrier, label: 'Barrier', color: '#C9A227', dashed: true });
  if (kind === 'multipliers' && firstQuote?.stopOut) lines.push({ value: firstQuote.stopOut, label: 'Stop out (Up)', color: 'var(--danger)', dashed: true });
  const oneSideBusy = (kind === 'accu' && open?.type === 'ACCU');

  const kindInfo = KINDS.find((k) => k.id === kind);
  const lastPrice = prices.length ? prices[prices.length - 1] : undefined;
  const firstPrice = prices[0];
  const change = lastPrice !== undefined && firstPrice ? lastPrice - firstPrice : 0;
  const stayed = (kind === 'accu' ? accuQuote?.stayed : undefined) ?? [];
  const bump = (d: number) => setStake((s) => String(Math.max(0.35, Number(s || 0) + d).toFixed(2)));

  return (
    <div className="mt2">
      <section className="mt2-chart card">
        <div className="mt2-market">
          <select className="mt2-sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
            {[...new Set(SYMBOLS.map((s) => s.group))].map((g) => (
              <optgroup key={g} label={g}>{SYMBOLS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            ))}
          </select>
          <span className={`mt2-px mono ${change >= 0 ? 'up' : 'down'}`}>
            {lastPrice !== undefined ? lastPrice.toFixed(decimals) : '—'} <small>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(decimals)}</small>
          </span>
        </div>
        <LiveChart prices={prices} times={times} lines={lines} decimals={decimals} />
        {stayed.length > 0 && (
          <div className="mt2-stats" title="How many ticks each recent run stayed inside the range">
            <b>Stats</b>
            {stayed.slice(-10).reverse().map((n, i) => <span key={i} className={i === 0 ? 'now' : ''}>{n}</span>)}
          </div>
        )}
      </section>

      <aside className="mt2-panel">
        <div className="mt2-type">
          <button className="mt2-type-btn" aria-expanded={picker} onClick={() => setPicker((p) => !p)}>
            <span className="mt2-type-ic" aria-hidden="true">↗</span>
            <b>{kindInfo?.label}</b>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {picker && (
            <div className="mt2-type-list" role="listbox">
              {kinds.map((k) => (
                <button key={k.id} role="option" aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => { setKind(k.id); setPicker(false); }}>{k.label}</button>
              ))}
            </div>
          )}
        </div>

        {kind === 'accu' && (
          <div className="mt2-box">
            <span className="mt2-lbl">Growth rate <InfoTip>{TIPS.growth}</InfoTip></span>
            <div className="mt2-chips">{[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => <button key={g} aria-pressed={growth === g} className={growth === g ? 'on' : ''} onClick={() => setGrowth(g)}>{g * 100}%</button>)}</div>
          </div>
        )}
        {kind === 'multipliers' && (
          <div className="mt2-box">
            <span className="mt2-lbl">Multiplier <InfoTip>{TIPS.multiplier}</InfoTip></span>
            <div className="mt2-chips">{mults.map((m) => <button key={m} aria-pressed={mult === m} className={mult === m ? 'on' : ''} onClick={() => setMult(m)}>×{m}</button>)}</div>
          </div>
        )}
        {usesTicks(kind) && (
          <div className="mt2-box">
            <span className="mt2-lbl">Duration · {ticks} tick{ticks === 1 ? '' : 's'} <InfoTip>{TIPS.duration}</InfoTip></span>
            <input type="range" min={range.min} max={range.max} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} aria-label="Ticks" />
          </div>
        )}
        {usesBarrier(kind) && (
          <div className="mt2-box">
            <span className="mt2-lbl">Barrier <InfoTip>{TIPS.barrier}</InfoTip></span>
            <input className="input mono" value={barrier} onChange={(e) => setBarrier(e.target.value.replace(/[^\d.+-]/g, ''))} placeholder="+0.30" aria-label="Barrier" />
          </div>
        )}
        {(kind === 'overunder' || kind === 'matchdiff') && (
          <div className="mt2-box">
            <span className="mt2-lbl">Last digit prediction <InfoTip>{TIPS.digit}</InfoTip></span>
            <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} className={digit === d ? 'on' : ''} aria-pressed={digit === d} onClick={() => setDigit(d)}>{d}</button>)}</div>
          </div>
        )}

        <div className="mt2-box">
          <span className="mt2-lbl">Stake <InfoTip>{TIPS.stake}</InfoTip></span>
          <div className="mt2-stake">
            <button aria-label="Decrease stake" onClick={() => bump(-1)}>−</button>
            <input className="mono" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Stake" />
            <span>{currency}</span>
            <button aria-label="Increase stake" onClick={() => bump(1)}>+</button>
          </div>
        </div>

        {(kind === 'accu' || kind === 'multipliers') && (
          <div className="mt2-box">
            <label className="mt2-check"><input type="checkbox" checked={useTp} onChange={(e) => setUseTp(e.target.checked)} /> Take profit <InfoTip>{TIPS.takeProfit}</InfoTip></label>
            {useTp && <input className="input mono" inputMode="decimal" placeholder="e.g. 5.00" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Take profit" />}
            {kind === 'multipliers' && (
              <>
                <span className="mt2-lbl" style={{ marginTop: 6 }}>Stop loss (optional)</span>
                <input className="input mono" inputMode="decimal" placeholder="e.g. 5.00" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Stop loss" />
              </>
            )}
          </div>
        )}

        {kind === 'accu' && accuQuote?.maxPayout !== undefined && (
          <div className="mt2-box mt2-facts">
            <span>Max. payout</span><b className="mono">{accuQuote.maxPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })} {currency}</b>
            <span>Max. ticks</span><b className="mono">{accuQuote.maxTicks} ticks</b>
          </div>
        )}

        <div className="mt2-buys">
          {SIDES[kind].map((side) => {
            const q = quotes[side.type];
            const showPayout = !['accu', 'multipliers'].includes(kind);
            const pred = (kind === 'overunder' || kind === 'matchdiff') ? ` ${side.type === 'DIGITUNDER' ? Math.max(1, digit) : side.type === 'DIGITOVER' ? Math.min(8, digit) : digit}` : '';
            return (
              <button key={side.type} className={`mt2-buy ${side.tone}`} disabled={isPreview || !q?.id || buying !== null || oneSideBusy} onClick={() => buy(side.type)}>
                <span className="mt2-buy-main">{buying === side.type ? 'Buying…' : `${side.label}${pred}`}</span>
                <span className="mt2-buy-sub mono">{q?.error ? '—' : q ? (showPayout ? `Payout ${q.payout.toFixed(2)} ${currency}` : `${q.ask.toFixed(2)} ${currency}`) : '…'}</span>
              </button>
            );
          })}
          {[...new Set(SIDES[kind].map((s) => quotes[s.type]?.error).filter(Boolean))].map((m) => <p key={m} className="error">{m}</p>)}
          {error && <p className="error" role="alert">{error}</p>}
          {isPreview && <p className="hint">Prices are live. Buying works once a client logs in.</p>}
          {!account?.isVirtual && account && <p className="hint" style={{ color: 'var(--danger)' }}>Real money account</p>}
        </div>

        {contracts.length > 0 && (
          <div className="mt2-box mt2-pos">
            <span className="mt2-lbl">Positions</span>
            {contracts.map((c) => (
              <div key={c.id} className="pos-row">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{c.type} · {symbolName(c.symbol).replace(' Index', '')}</span>
                  <span className="hint">{c.sold ? (c.status === 'won' || c.profit > 0 ? 'Won' : c.status === 'lost' || c.profit < 0 ? 'Lost' : 'Closed') : `Open${c.ticks ? ` · ${c.ticks} ticks` : ''}`} · stake {c.buy.toFixed(2)}</span>
                </div>
                <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <b className="mono" style={{ color: c.profit > 0 ? 'var(--success)' : c.profit < 0 ? 'var(--danger)' : undefined }}>{c.profit >= 0 ? '+' : ''}{c.profit.toFixed(2)}</b>
                  {c.validToSell && SELLABLE.has(c.type) && <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => sell(c.id)}>Sell</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
