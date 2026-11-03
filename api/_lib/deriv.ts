/** Deriv endpoints — see https://developers.deriv.com/llms.txt */
export const DERIV_AUTH_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
export const DERIV_API_BASE = 'https://api.derivws.com';

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Call the Deriv REST API with the user's OAuth bearer token. */
export async function derivFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${DERIV_API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}
