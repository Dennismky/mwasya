import { useMemo, useState } from 'react';

/** Pure maths, nothing is sent anywhere: how far a martingale-style sequence can go before the balance runs out. */
export default function RiskCalculator() {
  const [balance, setBalance] = useState('1000');
  const [stake, setStake] = useState('1');
  const [payout, setPayout] = useState('95');
  const [mult, setMult] = useState('2');
  const [winRate, setWinRate] = useState('50');
  const [levels, setLevels] = useState('8');

  const r = useMemo(() => {
    const B = Number(balance), s0 = Number(stake), pay = Number(payout) / 100, m = Number(mult), p = Number(winRate) / 100, L = Math.min(25, Math.max(1, Math.floor(Number(levels))));
    if (!(B > 0 && s0 > 0 && pay > 0 && m >= 1 && p > 0 && p < 1)) return null;
    const rows: { n: number; stake: number; lost: number; win: number; ok: boolean; prob: number }[] = [];
    let lost = 0, survive = 0;
    for (let n = 1; n <= L; n++) {
      const st = s0 * m ** (n - 1);
      const ok = lost + st <= B;
      if (ok) survive = n;
      rows.push({ n, stake: st, lost: lost + st, win: st * pay - lost, ok, prob: (1 - p) ** n * 100 });
      lost += st;
    }
    const ruin = (1 - p) ** survive * 100;
    return { rows, survive, ruin };
  }, [balance, stake, payout, mult, winRate, levels]);

  const num = (label: string, v: string, set: (s: string) => void, suffix?: string) => (
    <div className="field">
      <label className="label">{label}</label>
      <div className="input-group">
        <input className="input mono" inputMode="decimal" value={v} onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ''))} aria-label={label} />
        {suffix && <span className="addon">{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Risk Calculator</h1>
      <section className="card grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(170px, 100%), 1fr))', gap: 14 }}>
        {num('Balance', balance, setBalance, 'USD')}
        {num('Starting stake', stake, setStake, 'USD')}
        {num('Payout (profit per win)', payout, setPayout, '%')}
        {num('Multiply after loss', mult, setMult, '×')}
        {num('Win chance', winRate, setWinRate, '%')}
        {num('Losses to show', levels, setLevels)}
      </section>

      {!r ? <p className="error">Enter positive numbers (multiplier at least 1, win chance between 0 and 100).</p> : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
            <section className="card stack" style={{ gap: 6 }}>
              <span className="hint" style={{ fontWeight: 600 }}>LOSSES IN A ROW YOU CAN SURVIVE</span>
              <b className="mono" style={{ fontSize: 30 }}>{r.survive}</b>
            </section>
            <section className="card stack" style={{ gap: 6 }}>
              <span className="hint" style={{ fontWeight: 600 }}>CHANCE OF LOSING THEM ALL IN ONE SEQUENCE</span>
              <b className="mono" style={{ fontSize: 30, color: r.ruin > 1 ? 'var(--danger)' : 'var(--success)' }}>{r.ruin < 0.01 ? '<0.01' : r.ruin.toFixed(2)}%</b>
            </section>
          </div>
          <section className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Loss #</th><th>Stake</th><th>Total lost so far</th><th>Net if this one wins</th><th>Chance of reaching it</th></tr></thead>
              <tbody>
                {r.rows.map((x) => (
                  <tr key={x.n} style={{ opacity: x.ok ? 1 : 0.5 }}>
                    <td className="mono">{x.n}</td>
                    <td className="mono">{x.stake.toFixed(2)}</td>
                    <td className="mono" style={{ color: x.ok ? undefined : 'var(--danger)' }}>{x.lost.toFixed(2)}{!x.ok && ' · exceeds balance'}</td>
                    <td className="mono" style={{ color: x.win >= 0 ? 'var(--success)' : 'var(--danger)' }}>{x.win >= 0 ? '+' : ''}{x.win.toFixed(2)}</td>
                    <td className="mono">{x.prob.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="hint">Doubling after losses recovers small losses but risks the whole balance on a long losing streak. Use a stop loss.</p>
        </>
      )}
    </div>
  );
}
