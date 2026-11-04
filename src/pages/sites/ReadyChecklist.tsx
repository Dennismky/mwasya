import { useState } from 'react';
import { toast } from '../../components/motion';
import { useNavigate } from 'react-router-dom';

export interface Readiness {
  items: { id: string; state: 'ok' | 'todo' | 'warn'; title: string; detail: string; fix?: { label: string; step?: string; copy?: string } }[];
  left: number;
  done: boolean;
  clientLogins: number;
}

const STEP_INDEX: Record<string, number> = { deriv: 7, domain: 8, review: 9 };

/** What still stops clients from opening the site, logging in and trading — with a one-tap fix for each. */
export function ReadyChecklist({ siteId, ready, compact }: { siteId: string; ready: Readiness; compact?: boolean }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState('');
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); toast('Copied'); setTimeout(() => setCopied(''), 1500); } catch { /* clipboard blocked */ }
  };
  return (
    <div className={`ready ${compact ? 'ready-compact' : ''}`}>
      <div className="ready-head">
        <b>{ready.done ? 'Ready for clients' : `${ready.left} step${ready.left === 1 ? '' : 's'} before clients can trade`}</b>
        {ready.clientLogins > 0 && <span className="hint">{ready.clientLogins} client login{ready.clientLogins === 1 ? '' : 's'}</span>}
      </div>
      <ul>
        {ready.items.map((i) => (
          <li key={i.id} className={`ready-${i.state}`}>
            <span className="ready-icon" aria-hidden="true">{i.state === 'ok' ? '✓' : i.state === 'warn' ? '!' : '•'}</span>
            <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{i.title}</span>
              <span className="hint">{i.detail}</span>
            </span>
            {i.state !== 'ok' && i.fix && (
              i.fix.copy
                ? <button className="btn btn-secondary ready-fix" onClick={() => copy(i.fix!.copy!)}>{copied === i.fix.copy ? 'Copied' : 'Copy URI'}</button>
                : <button className="btn btn-secondary ready-fix" onClick={() => navigate(`/sites/${siteId}?step=${STEP_INDEX[i.fix!.step ?? 'review'] ?? 9}`)}>{i.fix.label}</button>
            )}
          </li>
        ))}
      </ul>
      {!ready.done && ready.items.some((i) => i.id.startsWith('login') && i.state === 'warn') && (
        <p className="hint">Deriv app redirect URIs: open <a href="https://developers.deriv.com" target="_blank" rel="noreferrer">developers.deriv.com</a> → your app → Redirect URIs → add the copied address.</p>
      )}
    </div>
  );
}
