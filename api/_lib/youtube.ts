/**
 * Ask YouTube about a video before saving it: its real title, and whether clients will be able to watch it here.
 * No API key is needed. If YouTube can't be reached, the video is still saved under a general title.
 */
export type VideoCheck = { ok: true; title: string } | { ok: false; error: string };

// EDIT HERE: the title used when YouTube can't be reached.
const FALLBACK_TITLE = 'Tutorial video';

export async function checkVideo(id: string): Promise<VideoCheck> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (r.status === 400 || r.status === 404) return { ok: false, error: 'We could not find that video on YouTube. Check the link.' };
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'This video is private or blocks other sites. On YouTube, set it to Public or Unlisted and allow embedding.' };
    if (!r.ok) return { ok: true, title: FALLBACK_TITLE };
    const j = (await r.json()) as { title?: unknown };
    const title = typeof j.title === 'string' ? j.title.trim().slice(0, 80) : '';
    return { ok: true, title: title || FALLBACK_TITLE };
  } catch {
    return { ok: true, title: FALLBACK_TITLE };
  }
}
