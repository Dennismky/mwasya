# Standalone client sites

A personal client's trading site that runs **on its own**: its own web address, its own Deriv app, its own look —
without the Mwasya studio, the Mwasya database, or mentor fees.

It reuses the same client-site screens as Mwasya (`../src/trader/`), so every improvement you make there reaches
these sites on their next deploy. **Nothing in this folder changes the Mwasya platform**, and nothing outside this
folder needs editing to add a client.

```
standalone/
├─ sites/
│  ├─ example.json          ← one settings file per client (copy this)
│  └─ example/bots/*.xml    ← that client's free bot files (optional)
├─ src/main.tsx             ← start file: shows the shared client-site screens
├─ api/                     ← small server for login / accounts (reuses ../api code, no database)
├─ vite.config.ts           ← build: publishes the client's settings as /site.json
├─ vercel.json              ← web rules + security headers for these sites
└─ index.html
```

---

## Add a new client — step by step

### 1. Settings file
Copy `sites/example.json` to `sites/<client>.json` (lowercase, letters/numbers/dashes, e.g. `sites/kamau-fx.json`) and edit:

| Field | What it does | Example |
|---|---|---|
| `name` | Site name shown everywhere | `"Kamau FX"` |
| `slug` | Short id (used for saved settings in the browser) | `"kamau-fx"` |
| `tagline` | Line on the login card | `"Smart bots for synthetic indices"` |
| `accent` | Main colour (blends with Mwasya navy) | `"#0E7C66"` |
| `theme` | Starting mode for clients | `"light"` or `"dark"` |
| `layout` | `"classic"` (top tabs), `"rail"` (side icons) or `"dock"` (bottom bar) | `"classic"` |
| `logo` | Full https link to a logo image, or `""` for initials | `"https://…/logo.png"` |
| `features` | Tabs to show: `bots`, `freebots`, `manual`, `charts`, `analysis`, `risk`, `learn`, `deposit` | |
| `freeBots` | Free bot files: `{ "id": "even-odd", "name": "Even/Odd bot", "description": "…" }` — put the file at `sites/<client>/bots/even-odd.xml` | |
| `announcements` | Bell messages: `{ "id": "a1", "title": "Welcome", "body": "Practise on demo first.", "date": "2026-11-05" }` | |

### 2. Deriv app (the client's own)
At **developers.deriv.com**, logged in as the client (or with them):
1. Register an app with the **trade** scope (add **payment** if they want the Cashier).
2. Redirect URI: `https://<their-domain>/callback` (add the `*.vercel.app` address too for testing).
3. Set their markup. Deriv pays it to them directly.
4. Copy the **App ID**.

### 3. Vercel project (one per client)
On vercel.com → **Add New → Project** → import this same GitHub repo, then set:

| Setting | Value |
|---|---|
| Root Directory | `standalone` |
| Framework Preset | Other |
| Install Command | `cd .. && npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| "Include files outside the Root Directory" | **On** (default) |

Environment variables:

| Name | Value |
|---|---|
| `SITE` | the settings file name, e.g. `kamau-fx` |
| `DERIV_APP_ID` | the App ID from step 2 |
| `SESSION_SECRET` | a new random secret for this site (`openssl rand -base64 48`) |

Deploy.

### 4. Domain
Vercel project → **Settings → Domains** → add the client's domain and copy the DNS records it shows into their
registrar (Namecheap, Truehost…). Make sure `https://<domain>/callback` is in the Deriv app's redirect URIs.

### 5. Test
Open the domain → Sign in with a Deriv demo account → run a bot, buy in Manual Trader, check Charts/Signals.

---

## Updating a client later
* Change their look or tabs: edit `sites/<client>.json`, commit, push → Vercel redeploys that client.
* Change the shared screens: edit `../src/trader/…` (see `../docs/CODE-MAP.md`), push → every project that is
  connected to the repo redeploys with the update.

## Run one locally
```bash
cd standalone
SITE=example DERIV_APP_ID=12345 npm run build   # builds dist/ for that client
npm run dev                                      # local preview (login needs a deployed https address)
```

## What standalone sites do not have
Mentor network, client counts, mentor fees and posting announcements from the studio — those belong to the Mwasya
platform. Announcements here come from the settings file.
