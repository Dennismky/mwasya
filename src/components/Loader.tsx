/** Signature loader: a ring that draws itself around the brand mark. */
export function Loader({ label = 'Loading', mark, size = 72, full = true }: { label?: string; mark?: string; size?: number; full?: boolean }) {
  const ring = (
    <div className="ld" role="status" aria-live="polite" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ld-track" cx="50" cy="50" r="44" />
        <circle className="ld-draw" cx="50" cy="50" r="44" />
        <circle className="ld-orbit" cx="50" cy="6" r="3.2" />
      </svg>
      <span className="ld-mark" aria-hidden="true">{mark ?? 'M'}</span>
      <span className="sr-only">{label}…</span>
    </div>
  );
  if (!full) return ring;
  return (
    <div className="ld-screen">
      {ring}
      <span className="ld-label">{label}</span>
    </div>
  );
}

/** Shimmer placeholder rows while data loads. */
export function Skeleton({ rows = 3, height = 16 }: { rows?: number; height?: number }) {
  return (
    <div className="sk" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ height, width: `${100 - (i % 3) * 14}%` }} />)}
    </div>
  );
}
