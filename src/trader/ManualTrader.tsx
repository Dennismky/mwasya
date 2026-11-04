import { useEffect, useMemo, useRef, useState } from 'react';
import { PREVIEW_ACCOUNT_ID, useAuth } from '../lib/auth';
import { accountSocket, publicSocket, type DerivSocket } from '../lib/derivWs';
import { TickChart, type ChartLine } from './TickChart';
import { SYMBOLS, decimalsOf, symbolName, useTicks } from './ticks';

type Kind = 'risefall' | 'overunder' | 'evenodd' | 'matchdiff' | 'accu';
const KINDS: { id: Kind; label: string }[] = [
  { id: 'risefall', label: 'Rise/Fall' },
  { id: 'overunder', label: 'Over/Under' },
  { id: 'evenodd', label: 'Even/Odd' },
  { id: 'matchdiff', label: 'Matches/Differs' },
  { id: 'accu', label: 'Accumulators' },
];
const SIDES: Record<Kind, { type: string; label: string; tone: 'up' | 'down' }[]> = {
  risefall: [{ type: 'CALL', label: 'Rise', tone: 'up' }, { type: 'PUT', label: 'Fall', tone: 'down' }],
  overunder: [{ type: 'DIGITOVER', label: 'Over', tone: 'up' }, { type: 'DIGITUNDER', label: 'Under', tone: 'down' }],
  evenodd: [{ type: 'DIGITEVEN', label: 'Even', tone: 'up' }, { type: 'DIGITODD', label: 'Odd', tone: 'down' }],
  matchdiff: [{ type: 'DIGITMATCH', label: 'Matches', tone: 'up' }, { type: 'DIGITDIFF', label: 'Differs', tone: 'down' }],
  accu: [{ type: 'ACCU', label: 'Buy', tone: 'up' }],
};

interface Quote { id: string; ask: number; payout: number; error?: string; high?: number; low?: number; maxTicks?: number; maxPayout?: number }
interface OpenC {
  id: number; type: string; buy: number; status: string; profit: number; bid?: number; sold: boolean;
  validToSell: boolean; entry?: number; exit?: number; high?: number; low?: number; ticks?: number; longcode?: string;
}

export default function ManualTrader() {
  const auth = useAuth();
  const account = auth.account;
  const currency = account?.currency ?? 'USD';
  const isPreview = account?.id === PREVIEW_ACCOUNT_ID;
  const [symbol, setSymbol] = useState('1HZ100V');
  const [kind, setKind] = useState<Kind>('risefall');
  const [stake, setStake] = useState('10');
  const [ticks, setTicks] = useState(5);
  const [digit, setDigit] = useState(5);
  const [growth, setGrowth] = useState(0.03);
  const [tp, setTp] = useState('');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [contracts, setContracts] = useState<OpenC[]>([]);
  const [nonce, setNonce] = useState(0);
  const ws = useRef<DerivSocket | null>(null);
  const watchers = useRef(new Map<number, () => void>());

  const { prices, times } = useTicks(symbol, 240);
  const decimals = useMemo(() => decimalsOf(prices), [prices.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Private trading socket for the selected account.
  useEffect(() => {
    if (!account?.id) return;
    // Preview has no client login: quote prices on Deriv's public feed, trading stays off.
    const s = account.id === PREVIEW_ACCOUNT_ID ? publicSocket() : accountSocket(account.id);
    ws.current = s;
    const w = watchers.current;
    return () => { w.forEach((u) => u()); w.clear(); s.close(); ws.current = null; };
  }, [account?.id]);

  // Live price quotes for the current ticket (re-quoted when anything changes, and after each buy).
  useEffect(() => {
    const s = ws.current;
    if (!s || !account) return;
    const amount = Number(stake);
    setQuotes({});
    if (!(amount > 0)) return;
    let alive = true;
    const offs: (() => void)[] = [];
    const t = setTimeout(() => {
      for (const side of SIDES[kind]) {
        const req: Record<string, unknown> = { proposal: 1, amount, basis: 'stake', contract_type: side.type, currency, underlying_symbol: symbol };
        if (kind === 'accu') {
          req.growth_rate = growth;
          if (Number(tp) > 0) req.limit_order = { take_profit: Number(tp) };
        } else { req.duration = ticks; req.duration_unit = 't'; }
        if (kind === 'overunder' || kind === 'matchdiff') req.barrier = String(side.type === 'DIGITUNDER' ? Math.max(1, digit) : side.type === 'DIGITOVER' ? Math.min(8, digit) : digit);
        s.subscribe(req, (m) => {
          if (!alive) return;
          const err = m.error as { message?: string } | undefined;
          if (err) return setQuotes((q) => ({ ...q, [side.type]: { id: '', ask: 0, payout: 0, error: err.message } }));
          const p = m.proposal as { id: string; ask_price: number; payout: number; contract_details?: { high_barrier?: string; low_barrier?: string; maximum_ticks?: number; maximum_payout?: number } } | undefined;
          if (p) setQuotes((q) => ({ ...q, [side.type]: {
            id: p.id, ask: p.ask_price, payout: p.payout,
            high: p.contract_details?.high_barrier ? Number(p.contract_details.high_barrier) : undefined,
            low: p.contract_details?.low_barrier ? Number(p.contract_details.low_barrier) : undefined,
            maxTicks: p.contract_details?.maximum_ticks, maxPayout: p.contract_details?.maximum_payout,
          } }));
        }).then((u) => (alive ? offs.push(u) : u())).catch((e: Error) => { if (e.message === 'SESSION_EXPIRED') auth.expire(); });
      }
    }, 300);
    return () => { alive = false; clearTimeout(t); offs.forEach((u) => u()); };
  }, [symbol, kind, stake, ticks, digit, growth, tp, currency, account?.id, nonce]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (sold) { watchers.current.get(id)?.(); watchers.current.delete(id); auth.refreshBalance(); }
    }).then((u) => watchers.current.set(id, u)).catch(() => undefined);
  };

  const buy = async (type: string) => {
    const s = ws.current, q = quotes[type];
    if (!s || !q?.id || !account) return;
    if (!account.isVirtual && !confirm(`Buy ${type} for ${q.ask.toFixed(2)} ${currency} on your REAL account?`)) return;
    setBuying(type); setError('');
    try {
      const r = await s.send<{ buy: { contract_id: number; buy_price: number; longcode?: string } }>({ buy: q.id, price: q.ask });
      setContracts((l) => [{ id: r.buy.contract_id, type, buy: r.buy.buy_price, status: 'open', profit: 0, sold: false, validToSell: false, longcode: r.buy.longcode }, ...l].slice(0, 20));
      watch(r.buy.contract_id);
      auth.refreshBalance();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBuying(null);
      setNonce((n) => n + 1); // fresh quote ids
    }
  };

  const sell = async (id: number) => {
    try { await ws.current?.send({ sell: id, price: 0 }); } catch (e) { setError((e as Error).message); }
  };

  const open = contracts.find((c) => !c.sold);
  const accuQuote = kind === 'accu' ? quotes.ACCU : undefined;
  const lines: ChartLine[] = [];
  if (open?.entry) lines.push({ value: open.entry, label: 'Entry', color: 'var(--primary)', dashed: true });
  const hi = open?.high ?? accuQuote?.high, lo = open?.low ?? accuQuote?.low;
  if ((open?.type === 'ACCU' || kind === 'accu') && hi && lo) {
    lines.push({ value: hi, label: 'High', color: '#3D8BFD', dashed: true }, { value: lo, label: 'Low', color: '#3D8BFD', dashed: true });
  }

  return (
    <div className="mt-layout">
      <section className="mt-chart card">
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <select className="input mt-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Market">
            {[...new Set(SYMBOLS.map((s) => s.group))].map((g) => (
              <optgroup key={g} label={g}>{SYMBOLS.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            ))}
          </select>
          <b className="mono" style={{ fontSize: 20 }}>{prices.length ? prices[prices.length - 1].toFixed(decimals) : '—'}</b>
        </div>
        <TickChart prices={prices} times={times} height={420} lines={lines} decimals={decimals} />
      </section>

      <aside className="mt-panel stack">
        <section className="card stack" style={{ gap: 12, padding: 16 }}>
          <div className="seg" role="tablist" aria-label="Trade type">
            {KINDS.map((k) => <button key={k.id} role="tab" aria-selected={kind === k.id} className={kind === k.id ? 'on' : ''} onClick={() => setKind(k.id)}>{k.label}</button>)}
          </div>

          {kind === 'accu' ? (
            <div className="field">
              <span className="label">Growth rate</span>
              <div className="seg">{[0.01, 0.02, 0.03, 0.04, 0.05].map((g) => <button key={g} aria-pressed={growth === g} className={growth === g ? 'on' : ''} onClick={() => setGrowth(g)}>{g * 100}%</button>)}</div>
            </div>
          ) : (
            <div className="field">
              <label className="label" htmlFor="mt-ticks">Duration: {ticks} tick{ticks === 1 ? '' : 's'}</label>
              <input id="mt-ticks" type="range" min={1} max={10} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
            </div>
          )}

          {(kind === 'overunder' || kind === 'matchdiff') && (
            <div className="field">
              <span className="label">Last digit prediction</span>
              <div className="digits">{Array.from({ length: 10 }, (_, d) => <button key={d} className={digit === d ? 'on' : ''} aria-pressed={digit === d} onClick={() => setDigit(d)}>{d}</button>)}</div>
            </div>
          )}

          <div className="field">
            <label className="label" htmlFor="mt-stake">Stake</label>
            <div className="input-group">
              <button className="btn btn-ghost" aria-label="Decrease stake" onClick={() => setStake((s) => String(Math.max(0.35, Number(s) - 1).toFixed(2)))}>−</button>
              <input id="mt-stake" className="input mono" style={{ textAlign: 'center' }} inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))} />
              <span className="addon">{currency}</span>
              <button className="btn btn-ghost" aria-label="Increase stake" onClick={() => setStake((s) => String((Number(s) + 1).toFixed(2)))}>+</button>
            </div>
          </div>

          {kind === 'accu' && (
            <div className="field">
              <label className="label" htmlFor="mt-tp">Take profit (optional)</label>
              <input id="mt-tp" className="input mono" inputMode="decimal" placeholder="e.g. 5" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^\d.]/g, ''))} />
              {accuQuote?.maxTicks && <span className="hint">Max payout {accuQuote.maxPayout?.toLocaleString()} {currency} · max {accuQuote.maxTicks} ticks</span>}
            </div>
          )}

          <div className="stack" style={{ gap: 8 }}>
            {SIDES[kind].map((side) => {
              const q = quotes[side.type];
              return (
                <button key={side.type} className={`buy-btn ${side.tone}`} disabled={isPreview || !q?.id || buying !== null || !!(kind === 'accu' && open?.type === 'ACCU')} onClick={() => buy(side.type)}>
                  <span>{buying === side.type ? 'Buying…' : side.label}{(kind === 'overunder' || kind === 'matchdiff') ? ` ${side.type === 'DIGITUNDER' ? Math.max(1, digit) : side.type === 'DIGITOVER' ? Math.min(8, digit) : digit}` : ''}</span>
                  <span className="mono">{q?.error ? '—' : q ? (kind === 'accu' ? `${q.ask.toFixed(2)} ${currency}` : `Payout ${q.payout.toFixed(2)}`) : '…'}</span>
                </button>
              );
            })}
            {SIDES[kind].map((s) => quotes[s.type]?.error && <p key={s.type} className="error">{quotes[s.type].error}</p>)}
            {error && <p className="error" role="alert">{error}</p>}
            {!account?.isVirtual && account && <p className="hint" style={{ color: 'var(--danger)' }}>Real money account</p>}
          </div>
        </section>

        <section className="card stack" style={{ gap: 8, padding: 16 }}>
          <b>Positions</b>
          {contracts.length === 0 ? <span className="hint">Your trades will show here.</span> : contracts.map((c) => (
            <div key={c.id} className="pos-row">
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{c.type} · {symbolName(symbol).replace(' Index', '')}</span>
                <span className="hint">{c.sold ? (c.status === 'won' || c.profit > 0 ? 'Won' : c.status === 'lost' || c.profit < 0 ? 'Lost' : 'Closed') : `Open${c.ticks ? ` · ${c.ticks} ticks` : ''}`} · stake {c.buy.toFixed(2)}</span>
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <b className="mono" style={{ color: c.profit > 0 ? 'var(--success)' : c.profit < 0 ? 'var(--danger)' : undefined }}>{c.profit >= 0 ? '+' : ''}{c.profit.toFixed(2)}</b>
                {c.validToSell && c.type === 'ACCU' && <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => sell(c.id)}>Sell</button>}
              </div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
