import { Icon } from '../components/ui';
import { Link } from 'react-router-dom';
import { useTrader } from './TraderApp';

/** Deriv Bot XML files the mentor published. Download, then Import in Deriv Bot. */
export default function FreeBots() {
  const { xmlBots, base, site } = useTrader();
  const builder = !site.features || site.features.includes('bots');
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Free Bots</h1>
        <p className="muted">Load a bot into Bot Builder to see and edit its stake, martingale, take profit and stop loss. Run it on Demo first.</p>
      </div>
      {xmlBots.length === 0 ? <section className="card"><p className="muted">No bot files yet. Check back soon.</p></section> : (
        <div className="grid">
          {xmlBots.map((x) => (
            <article key={x.id} className="card stack" style={{ gap: 12 }}>
              <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                <span className="tp-tile-icon"><Icon.Code /></span>
                <h2 style={{ fontSize: 17, fontWeight: 700 }}>{x.name}</h2>
              </div>
              {x.description && <p className="hint">{x.description}</p>}
              <div className="row" style={{ gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                {builder && <Link className="btn btn-primary" to={`${base}/bot-builder?bot=${x.id}`}><Icon.Chip /> Load in Bot Builder</Link>}
                <a className="btn btn-secondary" href={`/api/xmlbots/download?id=${x.id}`}><Icon.Download /> Download .xml</a>
              </div>
            </article>
          ))}
        </div>
      )}
      <a className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} href="https://app.deriv.com/bot" target="_blank" rel="noreferrer">Open Deriv Bot ↗</a>
    </div>
  );
}
