import type { DerivStrategy } from '../../src/shared/botSpec.js';

const PUBLIC_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';
const TTL_MS = 10 * 60_000;
let cache: { at: number; list: DerivStrategy[] } | undefined;

/** Deriv's live `auto_list_strategies` (public, no auth), cached per warm instance. */
export async function liveStrategies(): Promise<DerivStrategy[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.list;
  const list = await new Promise<DerivStrategy[]>((resolve, reject) => {
    const ws = new WebSocket(PUBLIC_WS);
    const timer = setTimeout(() => { ws.close(); reject(new Error('strategies_timeout')); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ auto_list_strategies: 1, req_id: 1 }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error('strategies_ws_error')); };
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      try {
        const msg = JSON.parse(String(ev.data)) as { error?: unknown; auto_list_strategies?: { strategies?: DerivStrategy[] } };
        const s = msg.auto_list_strategies?.strategies;
        if (msg.error || !Array.isArray(s)) reject(new Error('strategies_bad_response'));
        else resolve(s);
      } catch (e) {
        reject(e as Error);
      }
    };
  });
  cache = { at: Date.now(), list };
  return list;
}
