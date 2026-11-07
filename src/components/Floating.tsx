import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fitScale } from '../lib/fit';

/**
 * A floating button the client can drag anywhere. A short tap still works as a click.
 * The last position is remembered per button (localStorage) and always kept on screen.
 */
export function Floating({ id, start, onTap, label, className = '', children }: {
  id: string; start: { right?: number; left?: number; bottom: number }; onTap: () => void; label: string; className?: string; children: ReactNode;
}) {
  const key = `mw_float_${id}`;
  const el = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => { try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; } });
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null);

  const clamp = (x: number, y: number) => {
    const w = el.current?.offsetWidth ?? 60, h = el.current?.offsetHeight ?? 40;
    return { x: Math.min(Math.max(6, x), window.innerWidth - w - 6), y: Math.min(Math.max(6, y), window.innerHeight - h - 6) };
  };
  useEffect(() => {
    const fit = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', fit);
    fit();
    return () => window.removeEventListener('resize', fit);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
    el.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
    d.moved = true;
    setPos(clamp(e.clientX - d.dx, e.clientY - d.dy));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    try { el.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d?.moved) { if (pos) localStorage.setItem(key, JSON.stringify(pos)); } else onTap();
  };

  const style: React.CSSProperties = pos ? { left: pos.x / fitScale(), top: pos.y / fitScale() } : { right: start.right, left: start.left, bottom: start.bottom };
  return (
    <button ref={el} className={`fl ${className} ${drag.current?.moved ? 'dragging' : ''}`} style={style} aria-label={label} title={`${label} · drag to move`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}>
      {children}
    </button>
  );
}
