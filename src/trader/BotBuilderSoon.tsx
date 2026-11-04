import { Link } from 'react-router-dom';
import { Icon } from '../components/ui';
import { useTrader } from './TraderApp';

export default function BotBuilderSoon() {
  const { base } = useTrader();
  return (
    <section className="card stack" style={{ gap: 12, maxWidth: 620 }}>
      <span className="tp-tile-icon"><Icon.Gear /></span>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Bot Builder is coming</h1>
      <p className="muted">Soon you'll build your own bot here with drag-and-drop blocks. Until then, run a ready-made bot or load a bot file into Deriv Bot.</p>
      <div className="row" style={{ gap: 8 }}>
        <Link className="btn btn-primary" to={`${base}/quick-bot`}>Open Quick Bot</Link>
        <Link className="btn btn-secondary" to={`${base}/free-bots`}>Free Bots</Link>
      </div>
    </section>
  );
}
