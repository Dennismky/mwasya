import { fitScale } from '../lib/fit';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------- Scrollspy: children rise in, staggered, when they scroll into view ---------- */
export function Reveal({ children, as: Tag = 'div', className = '', stagger = 70, style }: {
  children: ReactNode; as?: 'div' | 'section' | 'ul' | 'ol'; className?: string; stagger?: number; style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    Array.from(el.children).forEach((c, i) => (c as HTMLElement).style.setProperty('--rv-delay', `${i * stagger}ms`));
    if (reduced() || !('IntersectionObserver' in window)) { el.classList.add('rv-in'); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('rv-in'); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, [stagger]);
  const T = Tag as 'div';
  return <T ref={ref as RefObject<HTMLDivElement>} className={`rv ${className}`} style={style}>{children}</T>;
}

/* ---------- Count-up numbers: "$1,240.50" animates from 0 ---------- */
export function CountUp({ value, duration = 900 }: { value: string; duration?: number }) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const m = value.match(/-?[\d,]*\.?\d+/);
    if (!m || reduced()) { setOut(value); return; }
    const raw = m[0];
    const target = Number(raw.replace(/,/g, ''));
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    const comma = raw.includes(',') || Math.abs(target) >= 1000;
    const fmt = (n: number) => (comma ? n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : n.toFixed(decimals));
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setOut(value.replace(raw, fmt(target * eased)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{out}</>;
}

/* ---------- Spotlight: a soft glow follows the cursor on any .spot element ---------- */
export function useSpotlight() {
  useEffect(() => {
    if (reduced() || !window.matchMedia('(hover: hover)').matches) return;
    const move = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('.spot') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left) / fitScale()}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top) / fitScale()}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);
}

/** Mount once: enables the cursor spotlight on every `.spot` element. */
export function Spotlight() { useSpotlight(); return null; }

/* ---------- Route progress bar: a thin bar sweeps across the top on every page change ---------- */
export function RouteBar() {
  const { pathname } = useLocation();
  const [k, setK] = useState(0);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setK((n) => n + 1); }, [pathname]);
  return k ? <span key={k} className="routebar" aria-hidden="true" /> : null;
}

/* ---------- Back to top: appears after scrolling a scroll container ---------- */
export function ToTop({ target }: { target: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el: HTMLElement | Window | null = target === "window" ? window : document.querySelector<HTMLElement>(target);
    if (!el) return;
    const on = () => setShow((el === window ? window.scrollY : (el as HTMLElement).scrollTop) > 480);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, [target]);
  return (
    <button className={`totop ${show ? 'on' : ''}`} aria-label="Back to top" tabIndex={show ? 0 : -1}
      onClick={() => (target === "window" ? window : document.querySelector(target))?.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
    </button>
  );
}

/* ---------- Notifications: toast('Saved', 'success') from anywhere ---------- */
type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; text: string; kind: ToastKind; out?: boolean }
let push: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
export const toast = (text: string, kind: ToastKind = 'success') => push?.({ text, kind });

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let id = 0;
    push = (t) => {
      const n = ++id;
      setItems((xs) => [...xs.slice(-3), { ...t, id: n }]);
      setTimeout(() => setItems((xs) => xs.map((x) => (x.id === n ? { ...x, out: true } : x))), 3800);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== n)), 4200);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind} ${t.out ? 'out' : ''}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
          <span className="toast-ic">{t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
          <span>{t.text}</span>
          <i className="toast-bar" />
        </div>
      ))}
    </div>
  );
}
