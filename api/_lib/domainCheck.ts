import { promises as dns } from 'node:dns';

/** Two-part public suffixes common for our users: a name like brand.co.ke is the registered domain, not co.ke. */
const PUBLIC_SUFFIXES = new Set([
  'co.ke', 'or.ke', 'ac.ke', 'go.ke', 'ne.ke', 'me.ke', 'info.ke', 'sc.ke', 'mobi.ke',
  'co.tz', 'or.tz', 'ac.tz', 'go.tz', 'co.ug', 'or.ug', 'ac.ug', 'go.ug', 'co.rw', 'ac.rw',
  'com.ng', 'org.ng', 'net.ng', 'edu.ng', 'gov.ng', 'com.gh', 'org.gh', 'edu.gh',
  'co.za', 'org.za', 'net.za', 'web.za', 'co.zw', 'co.zm', 'com.zm', 'co.bw', 'co.mz',
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'co.in', 'net.in', 'org.in', 'firm.in',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ph', 'com.my', 'com.sg', 'com.pk', 'com.bd', 'com.tr', 'com.eg',
  'co.jp', 'co.kr', 'co.id', 'co.th', 'com.cn', 'com.hk', 'com.tw', 'com.vn', 'com.sa', 'com.ae',
]);

const NOT_ACTIVE = /client ?hold|server ?hold|redemption ?period|pending ?delete|inactive/i;

export type DomainVerdict =
  | { ok: true; apex: string; expires?: string }
  | { ok: false; error: string };

let bootstrap: { at: number; map: Map<string, string> } | null = null;
/** IANA's official list of each TLD's registry RDAP server (cached for a day). */
async function rdapServer(tld: string, signal: AbortSignal): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > 86_400_000) {
    const r = await fetch('https://data.iana.org/rdap/dns.json', { signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { services: [string[], string[]][] };
    const map = new Map<string, string>();
    for (const [tlds, urls] of j.services) { const u = urls.find((x) => x.startsWith('https://')) ?? urls[0]; for (const t of tlds) map.set(t, u); }
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map.get(tld) ?? null;
}

const hasNs = async (name: string): Promise<boolean> => {
  try { return (await dns.resolveNs(name)).length > 0; } catch { return false; }
};

/**
 * Before connecting a domain bought anywhere (Namecheap, GoDaddy, Truehost…):
 * 1. DNS: the registered domain must exist and have nameservers (unregistered names have none).
 * 2. RDAP (the registry's public record): it must not be expired, on hold or awaiting deletion (i.e. unpaid).
 */
export async function verifyRegistered(domain: string): Promise<DomainVerdict> {
  const labels = domain.split('.');
  let apex = '';
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join('.');
    if (PUBLIC_SUFFIXES.has(name)) break;
    if (await hasNs(name)) { apex = name; break; }
  }
  if (!apex) {
    const base = labels.slice(-2).join('.');
    const reg = PUBLIC_SUFFIXES.has(base) ? labels.slice(-3).join('.') : base;
    return { ok: false, error: `${reg} is not registered. Check the spelling, or buy it first.` };
  }

  // Registry record. Some country domains have no RDAP service; DNS alone then decides.
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const server = await rdapServer(apex.split('.').pop()!, ctl.signal);
    const r = server ? await fetch(`${server.endsWith('/') ? server : `${server}/`}domain/${encodeURIComponent(apex)}`, { headers: { Accept: 'application/rdap+json' }, signal: ctl.signal }) : null;
    clearTimeout(t);
    if (r?.ok) {
      const j = (await r.json()) as { status?: string[]; events?: { eventAction?: string; eventDate?: string }[] };
      const status = (j.status ?? []).join(', ');
      const expires = j.events?.find((e) => e.eventAction === 'expiration')?.eventDate;
      if (NOT_ACTIVE.test(status)) return { ok: false, error: `${apex} is not active (${status}). Renew or pay for it with your registrar, then try again.` };
      if (expires && Date.parse(expires) < Date.now()) return { ok: false, error: `${apex} expired on ${expires.slice(0, 10)}. Renew it with your registrar, then try again.` };
      return { ok: true, apex, expires };
    }
  } catch { /* registry lookup unavailable: DNS already confirmed it exists */ }
  return { ok: true, apex };
}
