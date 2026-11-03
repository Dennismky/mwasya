/**
 * Minimal Deriv Options WebSocket client with request/response correlation.
 * - Public market data: wss://api.derivws.com/trading/v1/options/ws/public (no auth)
 * - Private (balance, buy, portfolio): one-time URL from /api/deriv/otp — no auth message needed.
 */

export const PUBLIC_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

type Json = Record<string, unknown>;
type Listener = (msg: Json) => void;

export class DerivSocket {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: Json) => void; reject: (e: Error) => void }>();
  private listeners = new Map<number, Listener>();
  private openPromise: Promise<void> | null = null;
  private keepAlive: ReturnType<typeof setInterval> | undefined;
  private closeHandlers = new Set<() => void>();
  private closedByUser = false;
  private subIndex = new Map<string, number>(); // subscription id → req_id

  constructor(private readonly urlProvider: () => Promise<string> | string) {}

  /** Called whenever the socket drops (not when close() is called). Returns an unregister function. */
  onDisconnect(cb: () => void): () => void {
    const wrapped = () => { if (!this.closedByUser) cb(); };
    this.closeHandlers.add(wrapped);
    return () => this.closeHandlers.delete(wrapped);
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.openPromise) return this.openPromise;
    this.openPromise = (async () => {
      const url = await this.urlProvider();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => {
          // Deriv drops idle sockets — keep this one alive (ping has its own rate budget).
          this.keepAlive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ping: 1 }));
          }, 30_000);
          resolve();
        };
        ws.onerror = () => reject(new Error('Could not connect to Deriv'));
        ws.onmessage = (ev) => this.onMessage(ev.data);
        ws.onclose = () => {
          if (this.keepAlive) clearInterval(this.keepAlive);
          this.keepAlive = undefined;
          for (const p of this.pending.values()) p.reject(new Error('Connection to Deriv was lost. Please try again.'));
          this.pending.clear();
          // Tell live subscriptions their stream ended, so the UI never waits silently.
          const lost = { error: { code: 'Disconnected', message: 'Connection to Deriv was lost.' } };
          for (const l of this.listeners.values()) l(lost);
          this.listeners.clear();
          this.subIndex.clear();
          if (this.ws === ws) this.ws = null;
          this.openPromise = null;
          for (const cb of this.closeHandlers) cb();
        };
      });
    })();
    try {
      await this.openPromise;
    } catch (e) {
      this.openPromise = null;
      throw e;
    }
  }

  private onMessage(data: unknown) {
    let msg: Json;
    try {
      msg = JSON.parse(String(data)) as Json;
    } catch {
      return;
    }
    const subId = (msg.subscription as { id?: string } | undefined)?.id;
    let id = typeof msg.req_id === 'number' ? msg.req_id : undefined;
    // Some stream updates carry only the subscription id — route those too.
    if (id === undefined && subId) id = this.subIndex.get(subId);
    if (id === undefined) return;
    if (subId && this.listeners.has(id)) this.subIndex.set(subId, id);
    const listener = this.listeners.get(id);
    if (listener) listener(msg);
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      const err = msg.error as { message?: string } | undefined;
      if (err) p.reject(new Error(err.message ?? 'Deriv API error'));
      else p.resolve(msg);
    }
  }

  async send<T extends Json = Json>(request: Json, timeoutMs = 20_000): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Connection to Deriv was lost. Please try again.');
    const req_id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(req_id)) reject(new Error('Deriv did not respond in time. Please try again.'));
      }, timeoutMs);
      this.pending.set(req_id, {
        resolve: (m) => { clearTimeout(timer); resolve(m as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify({ ...request, req_id }));
    });
  }

  /** Subscribe (e.g. { ticks: 'R_100', subscribe: 1 }). Returns an unsubscribe function. */
  async subscribe(request: Json, onMessage: Listener): Promise<() => void> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Connection to Deriv was lost. Please try again.');
    const req_id = this.nextId++;
    let subId: string | undefined;
    this.listeners.set(req_id, (msg) => {
      const sid = (msg.subscription as { id?: string } | undefined)?.id;
      if (sid) subId = sid;
      onMessage(msg);
    });
    ws.send(JSON.stringify({ ...request, subscribe: 1, req_id }));
    return () => {
      this.listeners.delete(req_id);
      if (subId) this.subIndex.delete(subId);
      // Tell Deriv to stop streaming (best effort).
      if (subId && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ forget: subId }));
    };
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

export function publicSocket(): DerivSocket {
  return new DerivSocket(() => PUBLIC_WS_URL);
}

/** Private socket for one account. Fetches a fresh one-time URL on every (re)connect. */
export function accountSocket(accountId: string): DerivSocket {
  return new DerivSocket(async () => {
    const r = await fetch('/api/deriv/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ accountId }),
    });
    if (r.status === 401) throw new Error('SESSION_EXPIRED');
    if (!r.ok) throw new Error('Could not open a trading connection');
    const { url } = (await r.json()) as { url: string };
    return url;
  });
}
