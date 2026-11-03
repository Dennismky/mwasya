import { challengeFromVerifier, randomString } from './pkce';
import { loadTenant } from './tenant';

/**
 * Deriv OAuth 2.0 (authorization code + PKCE).
 * Docs: https://developers.deriv.com/llms/oauth.md
 *
 * - The browser only ever handles the short-lived, single-use `code`.
 * - The code is exchanged on our server (/api/auth/token), which keeps the
 *   access token in an encrypted HttpOnly cookie.
 * - We request ONLY the `trade` scope: never `payment` or `account_manage`.
 */

const AUTHORIZE_URL = 'https://auth.deriv.com/oauth2/auth';
const SCOPES = ['trade'];
const KEY_STATE = 'mw_oauth_state';
const KEY_VERIFIER = 'mw_oauth_verifier';
const KEY_RETURN = 'mw_oauth_return';
/** Invite code from mwasya.site/?invite=CODE — sent once with the login, then cleared. */
export const KEY_INVITE = 'mw_invite';

/** Studio uses Mwasya's app ID; a trader site uses its operator's own app ID (from /api/site). */
export async function appId(): Promise<string> {
  const t = await loadTenant();
  const id = t.kind === 'site' ? t.site.appId : (t.kind === 'platform' && t.appId) || (import.meta.env.VITE_DERIV_APP_ID as string | undefined);
  if (!id) throw new Error('This site has no Deriv app configured yet.');
  return id;
}

export function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

export async function startLogin(opts: { signup?: boolean; returnTo?: string } = {}): Promise<void> {
  const state = randomString(16);
  const verifier = randomString(32);
  const challenge = await challengeFromVerifier(verifier);

  sessionStorage.setItem(KEY_STATE, state);
  sessionStorage.setItem(KEY_VERIFIER, verifier);
  sessionStorage.setItem(KEY_RETURN, opts.returnTo ?? '/app');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: await appId(),
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (opts.signup) params.set('prompt', 'registration');
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

export type CallbackResult = { ok: true; returnTo: string } | { ok: false; error: string };

/** Run on /callback. Verifies state, strips the code from the URL, exchanges it server-side. */
export async function completeLogin(search: string): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  // Remove code/state from the address bar and history immediately.
  window.history.replaceState(null, '', window.location.pathname);

  const error = params.get('error');
  if (error) return { ok: false, error: params.get('error_description') ?? error };

  const code = params.get('code');
  const state = params.get('state');
  const expected = sessionStorage.getItem(KEY_STATE);
  const verifier = sessionStorage.getItem(KEY_VERIFIER);
  const returnTo = sessionStorage.getItem(KEY_RETURN) ?? '/app';
  sessionStorage.removeItem(KEY_STATE);
  sessionStorage.removeItem(KEY_VERIFIER);
  sessionStorage.removeItem(KEY_RETURN);

  if (!code || !state || !expected || !verifier) return { ok: false, error: 'Missing login details. Please try again.' };
  if (state !== expected) return { ok: false, error: 'Login check failed (state mismatch). Please try again.' };

  const r = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ code, code_verifier: verifier, invite: localStorage.getItem(KEY_INVITE) ?? undefined }),
  });
  if (r.status === 429) return { ok: false, error: 'Too many login attempts. Please wait a few minutes and try again.' };
  if (!r.ok) return { ok: false, error: 'Could not complete login with Deriv. Please try again.' };
  localStorage.removeItem(KEY_INVITE);
  return { ok: true, returnTo: safeReturnPath(returnTo) };
}

export async function getSession(): Promise<{ loggedIn: boolean; expiresAt?: number; operator?: boolean }> {
  const r = await fetch('/api/auth/session', { credentials: 'same-origin' });
  if (!r.ok) return { loggedIn: false };
  return r.json();
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

/** Only same-app paths like "/forge" — never "//evil.com", "/\evil.com" or "https://…" (open-redirect guard). */
export function safeReturnPath(p: string | null | undefined): string {
  if (typeof p !== 'string' || p.length > 200) return '/app';
  if (p[0] !== '/' || p[1] === '/' || p[1] === '\\') return '/app'; // "//host" and "/\host" are treated as other sites
  if (p.includes('\\') || p.includes(':') || /[\s<>"']/.test(p)) return '/app';
  return p;
}
