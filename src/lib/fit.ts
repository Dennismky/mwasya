/**
 * Fit the whole site to the screen. Windows display scaling (125–150%) on a laptop leaves far less room than a desktop,
 * so the layout is scaled down as one piece and looks like it does on a desktop, instead of each page being squeezed.
 * Phones and tablets keep their own layouts.
 */
// EDIT HERE: the screen size the site is designed for, and the width below which phone layouts take over.
const DESIGN_WIDTH = 1440, DESIGN_HEIGHT = 820, PHONE_LAYOUT_BELOW = 1001;
// EDIT HERE: the smallest scale. Sharper (scaled) screens can go smaller and stay readable.
const MIN_SCALE_SHARP = 0.7, MIN_SCALE_NORMAL = 0.85;

let scale = 1;
/** Current scale. Mouse positions are in screen pixels, so divide them by this before placing anything inside the page. */
export const fitScale = () => scale;

export function computeScale(width: number, height: number, pixelRatio: number): number {
  if (width < PHONE_LAYOUT_BELOW) return 1;
  const floor = pixelRatio >= 1.25 ? MIN_SCALE_SHARP : MIN_SCALE_NORMAL;
  return Math.round(Math.max(floor, Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT)) * 100) / 100;
}

function apply() {
  const next = computeScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  if (next === scale && document.documentElement.style.getPropertyValue('--fit')) return;
  scale = next;
  const root = document.documentElement.style;
  root.setProperty('--fit', String(scale));
  root.setProperty('zoom', scale === 1 ? '' : String(scale));
  document.documentElement.classList.toggle('fit-on', scale !== 1);
  window.dispatchEvent(new Event('fitchange'));
}

export function startFit() {
  apply();
  window.addEventListener('resize', apply);
}
