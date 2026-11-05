import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * First-line flood guard: counts requests per visitor IP per endpoint in this server instance's memory and
 * answers 429 before any database or Deriv work. It is cheap (no I/O), so a flood is turned away in microseconds.
 * The Postgres-backed `rateLimit` in guard.ts stays as the second line for sensitive actions (login, payments…).
 * Vercel's own platform DDoS protection sits in front of both.
 */
const hits = new Map<string, { n: number; reset: number }>();
let lastSweep = Date.now();

function ip(req: VercelRequest): string {
  // Vercel sets x-vercel-forwarded-for itself (clients can't spoof it); fall back for local dev.
  const v = String(req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return v || req.socket?.remoteAddress || 'unknown';
}

/** Returns false (and has already answered 429) when this IP sent more than `max` requests in `windowSec`. */
export function burst(req: VercelRequest, res: VercelResponse, name: string, max = 120, windowSec = 60): boolean {
  const now = Date.now();
  // Forget old entries now and then so memory stays small.
  if (now - lastSweep > 60_000 || hits.size > 50_000) {
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    lastSweep = now;
  }
  const key = `${name}:${ip(req)}`;
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowSec * 1000 }); return true; }
  e.n += 1;
  if (e.n <= max) return true;
  res.setHeader('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
  res.setHeader('Cache-Control', 'no-store');
  res.status(429).json({ error: 'too_many_requests' });
  return false;
}
