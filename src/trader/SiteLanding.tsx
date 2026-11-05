import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthCard } from '../components/AuthCard';
import { getSession, safeReturnPath, startLogin } from '../lib/derivAuth';
import type { SiteBranding } from '../lib/tenant';
import { templateOf } from '../shared/templates';
import { decimalsOf, symbolName, useTicks } from './ticks';

/** A live Deriv price chip: last price and the change over the ticks we have seen. */
function LiveChip({ symbol }: { symbol: string }) {
  const { prices } = useTicks(symbol, 60);
  const last = prices[prices.length - 1];
  const first = prices[0];
  const d = decimalsOf(prices);
  const pct = last !== undefined && first ? ((last - first) / first) * 100 : 0;
  const up = pct >= 0;
  return (
    <span>
      <b>{symbolName(symbol).replace(' Index', '')}</b>
      {last === undefined ? '…' : last.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}
      {last !== undefined && <em className={up ? 'up' : 'down'}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%</em>}
    </span>
  );
}

/** `/` on a trading site: the client's branded login card. Logged-in clients go straight to the platform. */
export default function SiteLanding({ site }: { site: SiteBranding }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as { from?: string; error?: string };
  const returnTo = safeReturnPath(state.from);
  const [checking, setChecking] = useState(true);
  const t = templateOf(site.template);

  useEffect(() => {
    getSession().then((s) => (s.loggedIn ? navigate(returnTo, { replace: true }) : setChecking(false))).catch(() => setChecking(false));
  }, [navigate, returnTo]);

  return (
    <AuthCard
      brand={{
        name: site.name,
        logoUrl: site.logoUrl,
        accent: site.accent,
        kicker: 'DERIV BOTS · TOOLS · LIVE MARKETS',
        blurb: site.tagline || t.hero,
        chips: <><LiveChip symbol="1HZ100V" /><LiveChip symbol="R_50" /></>,
      }}
      checking={checking}
      error={state.error}
      onStart={(signup) => startLogin({ signup, returnTo })}
      legal={<>© {new Date().getFullYear()} {site.name} · Built on the Deriv API · Trading derivatives involves risk.</>}
    />
  );
}
