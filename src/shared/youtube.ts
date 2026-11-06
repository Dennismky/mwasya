/**
 * YouTube video id from anything a mentor pastes: watch, youtu.be, shorts, live or embed links.
 * Returns null for anything else, so only real YouTube ids reach the page. No imports: runs in Vite and Vercel functions.
 */
export function youtubeId(input: string): string | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id: string | null | undefined;
  if (host === 'youtu.be') id = u.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, value] = u.pathname.split('/');
    id = kind === 'watch' ? u.searchParams.get('v') : ['shorts', 'live', 'embed', 'v'].includes(kind) ? value : null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
