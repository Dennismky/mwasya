import { useEffect, useRef, useState } from 'react';
import { Floating } from '../components/Floating';
import type { Announcement } from '../lib/tenant';
import { AnnouncementText } from '../components/AnnouncementText';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Floating, draggable bell with the mentor's announcements. Unread = newer than the last time this client opened it. */
export function Bell({ items, siteKey, siteName }: { items: Announcement[]; siteKey: string; siteName: string }) {
  const seenKey = `mw_seen_${siteKey}`;
  const [seen, setSeen] = useState(() => Number(localStorage.getItem(seenKey) ?? 0));
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const unread = items.filter((a) => Date.parse(a.created_at) > seen).length;
  const prev = useRef(unread);

  // A new announcement arriving makes the bell ring.
  useEffect(() => {
    if (unread > prev.current) { setRing(true); const t = setTimeout(() => setRing(false), 1200); prev.current = unread; return () => clearTimeout(t); }
    prev.current = unread;
  }, [unread]);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && items.length) {
      const newest = Math.max(...items.map((a) => Date.parse(a.created_at)));
      localStorage.setItem(seenKey, String(newest));
      setTimeout(() => setSeen(newest), 1500); // keep the "new" marks visible for a moment
    }
  };

  return (
    <>
      {/* EDIT HERE: bell start position on screen (clients can drag it; their spot is remembered). */}
      <Floating id="bell" start={{ left: 16, bottom: 96 }} onTap={toggle} label={unread ? `${unread} new announcements` : 'Announcements'} className={`fl-bell ${ring ? 'ring' : ''} ${unread ? 'has' : ''}`}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="fl-badge">{unread > 9 ? '9+' : unread}</span>}
      </Floating>
      {open && (
        <div className="an-wrap" onClick={() => setOpen(false)}>
          <section className="an-panel" role="dialog" aria-label="Announcements" onClick={(e) => e.stopPropagation()}>
            <header><b>Announcements</b><span className="hint">from {siteName}</span><button className="cx-x" aria-label="Close" onClick={() => setOpen(false)}>✕</button></header>
            <div className="an-list">
              {items.length === 0 ? <p className="bw-empty">No announcements yet.</p> : items.map((a, i) => {
                const fresh = Date.parse(a.created_at) > seen;
                return (
                  <article key={a.id} className={`an-card ${fresh ? 'fresh' : ''}`} style={{ animationDelay: `${i * 45}ms` }}>
                    <div className="an-top"><b>{a.title}</b>{fresh && <span className="an-new">NEW</span>}</div>
                    <AnnouncementText text={a.body} />
                    <small className="hint">{ago(a.created_at)}</small>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
