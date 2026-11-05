/** Site designs a mentor picks in the builder. Colour and light/dark can still be changed after picking. */
export const SITE_TEMPLATES = [
  { id: 'bothub', name: 'Bot Hub', blurb: 'Bots first, bold and dark', accent: '#1F4FD1', theme: 'dark', hero: 'Automated bots and one dashboard for every account you trade.' },
  { id: 'signaldesk', name: 'Signal Desk', blurb: 'Clean and bright, for signal groups', accent: '#0F6E9E', theme: 'light', hero: 'Follow the signals, run the bots, trade with confidence.' },
  { id: 'chartfloor', name: 'Chart Floor', blurb: 'Charts and analysis up front', accent: '#0E7C66', theme: 'dark', hero: 'Live charts, digit stats and tools to read the market.' },
  { id: 'primedesk', name: 'Prime Desk', blurb: 'Premium navy and gold', accent: '#C9A227', theme: 'light', hero: 'A premium desk for serious traders.' },
  { id: 'nightmarket', name: 'Night Market', blurb: 'Deep indigo, made for mobile', accent: '#3B3FB6', theme: 'dark', hero: 'Trade synthetics around the clock, from your phone.' },
] as const;
export type TemplateId = (typeof SITE_TEMPLATES)[number]['id'];
export const templateOf = (id: string | undefined) => SITE_TEMPLATES.find((t) => t.id === id) ?? SITE_TEMPLATES[0];

/** Tabs a site can show (Dashboard is always on). */
// EDIT HERE: tools a mentor can switch on/off for their site (ids used by TABS in TraderApp.tsx).
export const SITE_FEATURES = [
  { id: 'bots', label: 'Run bots', text: 'Quick Bot: one-tap ready-made bots' },
  { id: 'freebots', label: 'Free bot files', text: 'Deriv Bot XML downloads' },
  { id: 'manual', label: 'Trade by hand', text: 'Manual Trader with live chart' },
  { id: 'charts', label: 'Live prices', text: 'Charts and the price ticker' },
  { id: 'analysis', label: 'Analysis tools', text: 'Last-digit statistics' },
  { id: 'risk', label: 'Daily plan', text: 'Daily target, stop loss and stake' },
  { id: 'learn', label: 'Learn', text: 'Getting-started guide and FAQ' },
  { id: 'deposit', label: 'Deposit button', text: 'Opens the Deriv cashier' },
] as const;
export type FeatureId = (typeof SITE_FEATURES)[number]['id'];
export const DEFAULT_FEATURES: FeatureId[] = ['bots', 'freebots', 'manual', 'charts', 'analysis', 'risk', 'learn', 'deposit'];
