import { challengeFromVerifier, randomString } from './pkce';
import { loadTenant } from './tenant';

/**
 * Deriv OAuth 2.0 (authorization code + PKCE).
 * Docs: https://developers.deriv.com/llms/oauth.md
 *
 * - The browser only ever handles the short-lived, single-use `code`.
 * - The code is exchanged on our server (/api/auth/token), which keeps the
 *   access token in an encrypted HttpOnly cookie.
 * - Logins request ONLY the `trade` scope. `payment` is asked for only when the client opens the cashier,
 * -   and that grant is kept in a separate 15-minute cookie. Never `account_manage`.
 */

const AUTHORIZE_URL = 'https://auth.deriv.com/oauth2/auth';
const SCOPES = ['trade'];
const KEY_STATE = 'mw_oauth_state';
const KEY_VERIFIER = 'mw_oauth_verifier';
const KEY_RETURN = 'mw_oauth_return';
const KEY_PURPOSE = 'mw_oauth_purpose';
const KEY_INTENT = 'mw_oauth_intent';
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

/** `withEarnings` also asks for read-only `application_read` (Deriv markup statistics for the Commissions page). */
/**
 * `fresh`: Deriv always shows its email + password screen, even when another Deriv account is already signed in on this
 * browser (standard OAuth `prompt=login`). `email` pre-fills that screen (`login_hint`).
 */
export async function startLogin(opts: { signup?: boolean; returnTo?: string; withEarnings?: boolean; cashier?: boolean; fresh?: boolean; email?: string } = {}): Promise<void> {
  const state = randomString(16);
  const verifier = randomString(32);
  const challenge = await challengeFromVerifier(verifier);

  sessionStorage.setItem(KEY_STATE, state);
  sessionStorage.setItem(KEY_VERIFIER, verifier);
  sessionStorage.setItem(KEY_RETURN, opts.returnTo ?? '/app');
  if (opts.cashier) sessionStorage.setItem(KEY_PURPOSE, 'cashier'); else sessionStorage.removeItem(KEY_PURPOSE);
  sessionStorage.setItem(KEY_INTENT, opts.signup ? 'signup' : 'login');

  // Studio logins also read the mentor's markup stats once the platform has enabled it (see DERIV_EARNINGS_SCOPE).
  const tenant = await loadTenant();
  const studioEarnings = tenant.kind === 'platform' && tenant.earningsScope === true;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: await appId(),
    redirect_uri: redirectUri(),
    // Cashier step-up adds `payment` for that one grant only; it is stored apart from the trading session (15 minutes max).
    scope: (opts.cashier ? [...SCOPES, 'payment'] : opts.withEarnings || studioEarnings ? [...SCOPES, 'application_read'] : SCOPES).join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (opts.signup) params.set('prompt', 'registration');
  else if (opts.fresh) params.set('prompt', 'login');
  if (opts.email) params.set('login_hint', opts.email);
  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

export type CallbackResult = { ok: true; returnTo: string; notice?: string } | { ok: false; error: string };

/** Run on /callback. Verifies state, strips the code from the URL, exchanges it server-side. */
export async function completeLogin(search: string): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  // Remove code/state from the address bar and history immediately.
  window.history.replaceState(null, '', window.location.pathname);

  const error = params.get('error');
  const purpose = sessionStorage.getItem(KEY_PURPOSE);
  sessionStorage.removeItem(KEY_PURPOSE);
  if (error === 'invalid_scope' && purpose === 'cashier') return { ok: false, error: 'Deposits and withdrawals are not enabled for this site yet. The site owner must allow the payment scope on their Deriv app.' };
  if (error === 'access_denied' && purpose === 'cashier') return { ok: true, returnTo: '/app' };
  if (error === 'invalid_scope') return { ok: false, error: 'Earnings access is not enabled for this Deriv app yet. In the Deriv developer dashboard, allow the application_read scope, then try again.' };
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
    body: JSON.stringify({ code, code_verifier: verifier, invite: purpose === 'cashier' ? undefined : localStorage.getItem(KEY_INVITE) ?? undefined, purpose: purpose ?? undefined }),
  });
  if (r.status === 429) return { ok: false, error: 'Too many login attempts. Please wait a few minutes and try again.' };
  if (!r.ok) return { ok: false, error: 'Could not complete login with Deriv. Please try again.' };
  localStorage.removeItem(KEY_INVITE);
  // Pressed "Create account" but already known here: they are simply signed in, and we say so.
  const intent = sessionStorage.getItem(KEY_INTENT);
  sessionStorage.removeItem(KEY_INTENT);
  const j = (await r.json().catch(() => ({}))) as { returning?: boolean | null };
  const notice = purpose !== 'cashier' && intent === 'signup' && j.returning === true ? 'You already have an account, so we signed you in.' : undefined;
  return { ok: true, returnTo: safeReturnPath(returnTo), notice };
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
