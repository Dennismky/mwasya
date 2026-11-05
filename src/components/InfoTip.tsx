import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Small ⓘ that explains a trading term. Tap on phones, hover/focus on laptops. */
export function InfoTip({ children, label = 'More info' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="infotip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="infotip-btn" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>i</button>
      {open && <span role="tooltip" id={id} className="infotip-pop">{children}</span>}
    </span>
  );
}

/** Plain-language explanations used across the trading site. */
export const TIPS = {
  stake: 'The amount you put into each trade. On Rise/Fall, Digits, Higher/Lower and Touch it is the full cost of the trade.',
  duration: 'How long the trade lasts. A tick is one price update (about one second on 1s indices).',
  digit: 'The last digit of the price when the trade ends, from 0 to 9.',
  growth: 'Your stake grows by this % every tick the price stays inside the range. Higher rates grow faster but the range is narrower, so the trade can end sooner.',
  takeProfit: 'Closes the trade automatically once your profit reaches this amount.',
  stopLoss: 'Closes the trade automatically once your loss reaches this amount, so it never runs further against you.',
  multiplier: 'Multiplies your profit or loss from the price move. Your loss can never be more than your stake (stop out).',
  barrier: 'The price level the trade is measured against, set as a distance from the current price (e.g. +0.30).',
  payout: 'What you receive if the trade wins, including your stake.',
  demo: 'Demo uses virtual money: perfect for practising. Switch accounts at the top.',
} as const;
