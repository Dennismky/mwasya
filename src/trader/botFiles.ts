/**
 * Free bot files and the Bot Builder code, fetched ahead of time so a bot opens at once when the client picks it.
 */
const files = new Map<string, Promise<string>>();

/** A free bot's XML (fetched once per visit, then served from memory). */
export function fetchBotXml(id: string): Promise<string> {
  let p = files.get(id);
  if (!p) {
    p = fetch(`/api/xmlbots/download?id=${encodeURIComponent(id)}`).then((r) => { if (!r.ok) throw new Error('Could not load that bot.'); return r.text(); });
    p.catch(() => files.delete(id)); // a failed download is tried again next time
    files.set(id, p);
  }
  return p;
}

/** Load the block editor (Blockly) in the background so Bot Builder opens without a wait. */
let editor: Promise<unknown> | null = null;
export const preloadEditor = () => (editor ??= import('./BlockEditor'));

/** Run `fn` when the browser is idle (or soon, where idle callbacks don't exist). */
export function whenIdle(fn: () => void) {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 1200);
}
