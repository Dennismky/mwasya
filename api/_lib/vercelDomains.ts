/**
 * Adds/removes mentors' custom domains on our Vercel project so Vercel serves them (with automatic HTTPS).
 * Env (server only): VERCEL_TOKEN (scoped to this team), VERCEL_PROJECT_ID, VERCEL_TEAM_ID.
 * Docs: https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project
 */
const API = 'https://api.vercel.com';

export function domainsConfigured(): boolean {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);
}

async function call(path: string, init: RequestInit = {}) {
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
  const r = await fetch(`${API}${path}${team}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, j };
}

export interface DnsRecord { type: 'A' | 'CNAME' | 'TXT'; name: string; value: string; why: string }
export interface DomainState { verified: boolean; configured: boolean; records: DnsRecord[]; error?: string }

/** Is the domain the apex (statefx.pro) or a subdomain (trade.brand.com)? Simple heuristic incl. two-part TLDs like co.ke. */
export function isApex(domain: string): boolean {
  const parts = domain.split('.');
  const twoPartTld = /^(co|or|ac|go|ne|com|net|org|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.length === (twoPartTld ? 3 : 2);
}

function recordsFor(domain: string, verification: { type: string; domain: string; value: string }[] = []): DnsRecord[] {
  const apex = isApex(domain);
  const recs: DnsRecord[] = apex
    ? [{ type: 'A', name: '@', value: '76.76.21.21', why: 'Points your domain to your trading site' },
       { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com', why: 'Makes www work too' }]
    : [{ type: 'CNAME', name: domain.split('.')[0], value: 'cname.vercel-dns.com', why: 'Points this address to your trading site' }];
  for (const v of verification) {
    if (v.type === 'TXT') recs.push({ type: 'TXT', name: v.domain.replace(`.${domain}`, '').replace(domain, '@'), value: v.value, why: 'Proves you own the domain' });
  }
  return recs;
}

export async function addDomain(domain: string): Promise<DomainState> {
  const pid = encodeURIComponent(process.env.VERCEL_PROJECT_ID!);
  const r = await call(`/v10/projects/${pid}/domains`, { method: 'POST', body: JSON.stringify({ name: domain }) });
  const err = r.j.error as { code?: string; message?: string } | undefined;
  if (!r.ok && err?.code !== 'domain_already_in_use_by_project' && err?.code !== 'domain_already_exists') {
    return { verified: false, configured: false, records: recordsFor(domain), error: err?.message ?? `Vercel error ${r.status}` };
  }
  if (isApex(domain)) {
    // www → apex redirect (best effort).
    await call(`/v10/projects/${pid}/domains`, { method: 'POST', body: JSON.stringify({ name: `www.${domain}`, redirect: domain, redirectStatusCode: 308 }) }).catch(() => undefined);
  }
  return checkDomain(domain);
}

export async function checkDomain(domain: string): Promise<DomainState> {
  const pid = encodeURIComponent(process.env.VERCEL_PROJECT_ID!);
  const d = await call(`/v9/projects/${pid}/domains/${encodeURIComponent(domain)}`);
  if (d.status === 404) return { verified: false, configured: false, records: recordsFor(domain), error: 'Domain is not attached. Save it again.' };
  const verified = d.j.verified === true;
  const verification = (d.j.verification as { type: string; domain: string; value: string }[] | undefined) ?? [];
  const cfg = await call(`/v6/domains/${encodeURIComponent(domain)}/config`);
  const configured = cfg.ok && cfg.j.misconfigured === false;
  return { verified, configured, records: recordsFor(domain, verified ? [] : verification) };
}

export async function removeDomain(domain: string): Promise<void> {
  const pid = encodeURIComponent(process.env.VERCEL_PROJECT_ID!);
  await call(`/v9/projects/${pid}/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
  if (isApex(domain)) await call(`/v9/projects/${pid}/domains/${encodeURIComponent(`www.${domain}`)}`, { method: 'DELETE' }).catch(() => undefined);
}
