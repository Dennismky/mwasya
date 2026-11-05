import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side session for the Deriv access token.
 * The token lives only in an AES-256-GCM encrypted, HttpOnly cookie —
 * browser JavaScript can never read it.
 */

// __Host- prefix: browser only accepts it from this exact host, over HTTPS, Path=/ — no subdomain can plant or overwrite it.
const COOKIE = '__Host-mw_session';

export interface Session {
  accessToken: string;
  expiresAt: number; // epoch ms
  /** Mwasya operator (from Postgres). Absent if the DB was unreachable at login. */
  operatorId?: string;
  /** Set when the login happened on a trader site (<sub>.mwasya.site). */
  siteId?: string;
}

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  const k = Buffer.from(secret, 'base64');
  if (k.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes (base64)');
  return k.subarray(0, 32);
}

function encrypt(data: Session): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function decrypt(value: string): Session | null {
  try {
    const raw = Buffer.from(value, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    return JSON.parse(json) as Session;
  } catch {
    return null;
  }
}

function readCookie(req: VercelRequest, name: string): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

export function getSession(req: VercelRequest): Session | null {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const s = decrypt(raw);
  if (!s || Date.now() >= s.expiresAt) return null;
  return s;
}

export function setSession(res: VercelResponse, s: Session): void {
  const maxAge = Math.max(0, Math.floor((s.expiresAt - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encrypt(s)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  );
}

export function clearSession(res: VercelResponse): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

/** Basic CSRF guard for state-changing requests: Origin must match our host. */
export function sameOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function noStore(res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store');
}

/*
 * Cashier permission (Deriv `payment` scope). Kept apart from the trading session in its own cookie that
 * lasts at most 15 minutes, so funds can only be moved while the client is actively in the cashier.
 */
const PAY_COOKIE = '__Host-mw_pay';
const PAY_MAX_MS = 15 * 60 * 1000;

export function getPaySession(req: VercelRequest): Session | null {
  const raw = readCookie(req, PAY_COOKIE);
  if (!raw) return null;
  const s = decrypt(raw);
  if (!s || Date.now() >= s.expiresAt) return null;
  return s;
}

export function setPaySession(res: VercelResponse, accessToken: string, tokenExpiresAt: number, siteId?: string): number {
  const expiresAt = Math.min(tokenExpiresAt, Date.now() + PAY_MAX_MS);
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  res.setHeader('Set-Cookie', `${PAY_COOKIE}=${encrypt({ accessToken, expiresAt, siteId })}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
  return expiresAt;
}

export function clearPaySession(res: VercelResponse): void {
  res.setHeader('Set-Cookie', `${PAY_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
