# Mwasya

The operator platform for Deriv trading brands. Operators build bots with **Bot Forge**, publish them to their own branded site (`<brand>.mwasya.site`), and traders run them on their own Deriv accounts.

- **Studio:** https://mwasya.site
- **Trader sites:** `https://<brand>.mwasya.site`

**Stack:** React 18 · TypeScript · Vite · React Router · Zustand · Vercel serverless functions (`/api`) · Postgres (Neon) · Deriv API (OAuth + WebSockets)

---

> **Branches:** work on `dev`, release by merging into `master` (production). See [docs/BRANCHES.md](docs/BRANCHES.md).
>
> **Changing something?** See [docs/CODE-MAP.md](docs/CODE-MAP.md) for which file to edit for each feature, step-by-step recipes (e.g. notifications), and debugging tips. Search the code for `EDIT HERE` to jump to common settings.

## Quick start: copy, paste, run

Before you start:
- **Node.js 22 or newer.** The database script needs `node --env-file-if-exists`.
- **Git.**
- A **Vercel account** with access to the `mwasya.site` project.

The steps below install the tools, download the code, pull the settings from Vercel, prepare the database and start the app at **http://localhost:3000**.

### Windows (PowerShell)

```powershell
# 1) Tools (one time). Skip any you already have; reopen the terminal after installing.
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
npm install --global vercel@latest

# 2) Code
git clone https://github.com/Dennismky/mwasya.git
cd mwasya
npm install

# 3) Settings: log in to Vercel (a browser opens), link the project, pull DATABASE_URL and the rest
vercel login
vercel link --yes --project mwasya.site
vercel env pull .env.local --yes

# 4) Local Deriv login settings (the local callback is localhost, not mwasya.site)
$secret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
Add-Content -Encoding utf8 .env.local "`nVITE_DERIV_APP_ID=34RhH6jeO22uI72af7k8B`nDERIV_APP_ID=34RhH6jeO22uI72af7k8B`nDERIV_REDIRECT_URI=http://localhost:3000/callback`nSESSION_SECRET=$secret"

# 5) Database tables (safe to run again any time)
npm run db:migrate

# 6) Run the app + API at http://localhost:3000
vercel dev
```

### macOS / Linux / Git Bash

```bash
# 1) Tools (one time). Install Node.js 22+ and Git first (https://nodejs.org, https://git-scm.com).
npm install --global vercel@latest

# 2) Code
git clone https://github.com/Dennismky/mwasya.git && cd mwasya
npm install

# 3) Settings: log in to Vercel (a browser opens), link the project, pull DATABASE_URL and the rest
vercel login
vercel link --yes --project mwasya.site
vercel env pull .env.local --yes

# 4) Local Deriv login settings (the local callback is localhost, not mwasya.site)
cat >> .env.local <<EOF

VITE_DERIV_APP_ID=34RhH6jeO22uI72af7k8B
DERIV_APP_ID=34RhH6jeO22uI72af7k8B
DERIV_REDIRECT_URI=http://localhost:3000/callback
SESSION_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
EOF

# 5) Database tables (safe to run again any time)
npm run db:migrate

# 6) Run the app + API at http://localhost:3000
vercel dev
```

Open **http://localhost:3000** and click **Log in with Deriv**.

### Local testing tips (Windows)
- **`vercel dev` fails with `EPERM: operation not permitted, symlink`:** turn on Windows **Developer Mode** (Settings → System → For developers), or run the terminal **as administrator**.
- **`vercel` is blocked ("running scripts is disabled"):** run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call `vercel.cmd dev`.
- **The API can't see your settings (`appId: null`):** `vercel dev` reads `.env`, not `.env.local`. Copy it: `Copy-Item .env.local .env` (both are gitignored). Restart `vercel dev` after changing either file.
- **Open a client site locally:** `http://<subdomain>.localhost:3000` (e.g. `http://statefx.localhost:3000`) opens that mentor's trader site. This only works under `vercel dev`, never on Vercel deployments. Logging in there also needs `http://<subdomain>.localhost:3000/callback` on that site's Deriv app.
- **Careful:** local and preview use the same database as production unless you create a separate Neon branch for them.
- The `[vc] PATH TO REGEXP ERROR … :rest*` line at start-up is a harmless warning.

> **Login on localhost:** the Deriv app `34RhH6jeO22uI72af7k8B` must list `http://localhost:3000/callback` as a redirect URI, alongside `https://mwasya.site/callback`. The App ID is public; the session secret and database URL are not, which is why they live only in `.env.local` (gitignored) and in Vercel.

### Everyday commands

| Command | What it does |
|---|---|
| `vercel dev` | Run the frontend and API locally on port 3000 |
| `npm run build` | Typecheck and build for production |
| `npm run typecheck` | Typecheck only |
| `npm run db:migrate` | Apply [db/schema.sql](db/schema.sql) to `DATABASE_URL` (idempotent) |
| `npm run make-owner -- <DERIV_ACCOUNT_ID>` | Make that operator the platform owner (root of the network) |
| `git push` | Deploy. Pushing to `master` deploys mwasya.site automatically |

---

## Setting up a brand-new deployment (only if you're not using the existing project)

```bash
npm install --global vercel@latest
git clone https://github.com/Dennismky/mwasya.git && cd mwasya && npm install
vercel login
vercel link --yes                               # creates a new Vercel project
vercel git connect                              # deploy on every push to master
vercel integration add neon --name mwasya-db    # Postgres; accept Neon's terms in the browser if asked, then rerun
vercel env pull .env.local --yes
npm run db:migrate

# Production settings (paste values when asked)
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))" | vercel env add SESSION_SECRET production --sensitive
vercel env add DERIV_APP_ID production          # your Deriv App ID
vercel env add VITE_DERIV_APP_ID production     # same App ID
vercel env add DERIV_REDIRECT_URI production    # https://<your-domain>/callback

vercel domains add <your-domain>                # e.g. mwasya.site
vercel domains add "*.<your-domain>"            # trader sites: <brand>.<your-domain>
vercel deploy --prod
```

Then register a Deriv app at https://developers.deriv.com with the **trade** scope only. Its redirect URIs must be `https://<your-domain>/callback` and `http://localhost:3000/callback`.

---

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `VITE_DERIV_APP_ID` | browser | Mwasya's Deriv App ID (public) |
| `DERIV_APP_ID` | server | Same App ID, used for the token exchange on mwasya.site |
| `DERIV_REDIRECT_URI` | server | Must exactly match a redirect URI on the Deriv app. Production: `https://mwasya.site/callback`; local: `http://localhost:3000/callback` |
| `SESSION_SECRET` | server | 32+ random bytes, base64. Different values in local and production |
| `DATABASE_URL` | server | Postgres (Neon pooled URL). Added automatically by the Neon integration |
| `PUBLIC_BASE_URL` | server | `https://mwasya.site`, used to build the M-Pesa callback URL |
| `MPESA_ENV` | server | `sandbox` while testing, `production` when live |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | server | From your app on https://developer.safaricom.co.ke |
| `MPESA_SHORTCODE` / `MPESA_PASSKEY` | server | Lipa na M-Pesa Online shortcode and passkey (sandbox: `174379` + the test passkey from Daraja) |
| `MPESA_TYPE` | server | `paybill` (default) or `till` |
| `MPESA_PARTY_B` | server | Till number when `MPESA_TYPE=till`; leave empty for a Paybill |
| `MPESA_CALLBACK_KEY` | server | Long random string. Safaricom calls us back with it, and anything without it is rejected |
| `VERCEL_TOKEN` | server | Vercel access token (scope: this team) so mentors can connect their own domains |
| `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` | server | Values from `.vercel/project.json` (`projectId`, `orgId`) |
| `DERIV_EARNINGS_SCOPE` | server | `1` once `application_read` is enabled on Mwasya's Deriv app. Studio logins then also read each mentor's markup, so the owner sees every mentor's commission |

### Turning on custom domains and commission tracking
```bash
vercel env add VERCEL_TOKEN production --sensitive      # create at vercel.com/account/settings/tokens (scope: your team)
vercel env add VERCEL_PROJECT_ID production             # projectId from .vercel/project.json
vercel env add VERCEL_TEAM_ID production                # orgId from .vercel/project.json
vercel env add DERIV_EARNINGS_SCOPE production          # 1  (only after enabling application_read on the Deriv app)
vercel deploy --prod
```

### Turning on M-Pesa payments (copy-paste, then paste each value when asked)
```bash
vercel env add PUBLIC_BASE_URL production        # https://mwasya.site
vercel env add MPESA_ENV production              # sandbox (test) or production (live)
vercel env add MPESA_CONSUMER_KEY production --sensitive
vercel env add MPESA_CONSUMER_SECRET production --sensitive
vercel env add MPESA_SHORTCODE production
vercel env add MPESA_PASSKEY production --sensitive
node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))" | vercel env add MPESA_CALLBACK_KEY production --sensitive
vercel deploy --prod
```
Then, as the owner, open **Settings → Pricing** and set a price in KES. A price of 0 keeps Mwasya free.

**Domain sales:** with the Vercel variables above set, open **Settings → Domain sales** and tick *Let mentors buy domains*. Mentors search and pay with M-Pesa on **Sites → Choose your address**. Only after Safaricom confirms the payment do we register the domain on your Vercel account (never above the quoted price), then connect it automatically. Auto-renew is off, so renewals are never charged to you silently.

Trader sites don't use these Deriv values. Each operator site logs in with **the operator's own Deriv App ID**, stored in the `sites` table, so markup is paid to the operator.

---

## How it works

### Studio vs trader sites (one build, two apps)
`/api/site` looks at the request host:
- **`mwasya.site`**: the operator studio. You get the login card, then the dashboard with Overview, Bot Forge and My site.
- **`<brand>.mwasya.site`**: that operator's trader site. You get a branded login, then the operator's published bots, which traders run on their own accounts.
- **Unknown subdomain**: a "No site here yet" page.
- **Suspended or unpaid mentor (`held`)**: the site only shows its loading screen, says nothing about why, refuses client logins, and checks every 30 seconds so it opens by itself once the owner reactivates the mentor. Clients who had it open are moved to the loading screen within a minute.

### Deriv login (OAuth 2.0 + PKCE, `trade` scope only)
1. **Sign in** builds a PKCE challenge and `state`, then redirects to `auth.deriv.com/oauth2/auth` with `prompt=login`, so Deriv always shows its email + password screen (another Deriv account already open in that browser is never used by mistake). The optional email box is passed as `login_hint`. Sign up uses `prompt=registration`.
2. Deriv redirects to `/callback`. The page checks `state`, strips the code from the URL and POSTs it to `/api/auth/token`.
3. The server exchanges the code for an access token and stores it in an **AES-256-GCM encrypted, HttpOnly, Secure cookie**. The token never reaches browser JavaScript.
4. `/api/deriv/otp` turns that token into a **one-time WebSocket URL** for the selected account. The browser uses it for balance and trading.
5. Market data uses Deriv's public WebSocket, which needs no login.

Deriv issues no refresh tokens. When a session expires, the user logs in again.

### Bot Forge (`/forge`)
Bots run on **Deriv's servers** through the `auto_*` API ([docs](https://developers.deriv.com/llms/auto-start.md)). Mwasya builds, checks, starts and watches them.
- **Strategies:**
  - `fixed`: martingale with `max_stake` equal to `initial_stake`, so the stake never grows. Verified live.
  - `martingale` and `dalembert`.
  - Deriv's rules come from `auto_list_strategies` at runtime. Its docs example is wrong: money fields are strings.
- **Safety:** [src/shared/botSpec.ts](src/shared/botSpec.ts) runs in the browser for live feedback and on the server before every save.
  - Escalating strategies need a max stake, which can't exceed the stop loss.
  - Caps: stop loss 1000, max trades 500, martingale multiplier 3.
- **Stop:** no new trades are bought. A trade that's already open finishes normally. We follow it via `proposal_open_contract` so its result and payout are recorded.
- **Balance:** combines Deriv's live balance stream, a fresh read every 10 seconds, and a read after every trade. It always shows Deriv's real number.

### Client trading site (what traders get)
Clients log in with Deriv on `<brand>.mwasya.site` and trade on their own Deriv account (demo or real, picked in the account card).
- **One market everywhere.** The market a client picks in D-Circles, Charts, Signals, Manual Trader, the price bar or Bot Builder is shared by the whole site ([src/trader/market.ts](src/trader/market.ts)), so a bot always runs on the volatility that was analysed.
- **Account card:** real / demo accounts with US flags, balances shown in USD or KSh (live USD→KES rate, refreshed every 60 s; trades stay in USD).
- **Moving price bar:** a chip per market with a live mini chart, the price's last digit in a bubble (green up / red down), change since opening; click a chip to switch the site to that market.
- **Bot Builder:** Blockly workspace with a blocks menu (Trade parameters … Logic, Maths, Loops, Text, Lists, **Variables**, **Functions**).
  - Any Deriv Bot XML opens complete: unknown values are kept, if/else-if blocks stay real, extra fields are added, never dropped.
  - Edits save in the browser automatically ("✓ Saved"); Save downloads a copy.
  - Bots run in the browser on the client's account, block by block ([src/trader/xmlRunner.ts](src/trader/xmlRunner.ts)).
- **Quick Bot:**
  - the mentor's published bots, each with live 0–9 digit percentages (green = most frequent, red = least) and the share of recent ticks it would have won;
  - **Create your bot:** contract, digit, ticks, entry digit, stake, martingale, max stake, take profit, stop loss, run at once. The engine buys in **one request** (`buy: "1"` with `parameters`), so it catches the tick it waits for ([src/trader/botEngine.ts](src/trader/botEngine.ts)).
- **Charts:** candles or ticks, indicators, drawings; dragging left loads older history (back to previous days); prices use each market's own decimals.
- **D-Circles, Signals:** live last-digit statistics; buttons send an Over/Under bot for the same market to Bot Builder.
- **Daily Plan:** "Use this plan in Bot Builder" opens Quick strategy filled with the plan's stake, take profit and stop loss.
- **Bell:** the mentor's announcements; a WhatsApp group link shows as a green **Join WhatsApp group** button.
- **Safety:** "Stop when I leave" stops a bot (after its open trade) when the client leaves the bot pages or the tab; real-account runs always ask first and name the market.

### Mentor tools (studio)
- **Sites:** build and publish a branded client site. Once it is live and set up, **Your client link** appears with Copy / WhatsApp / Telegram share buttons (clients trading through it earn the mentor markup).
- **Settings → Website colours:** the site's main colour and the look clients see first (light / dark), with a live preview. Clients see changes within about 30 seconds.
- **XML Bots:** upload Deriv Bot files, publish them, and choose per site which ones show under Free Bots. The owner can tick **Catalog** to offer a bot to every mentor.
- **Announcements:** title, message and an optional WhatsApp group link, posted to a site's bell.
- **Settings → Tutorial videos:** drag or paste a YouTube link (Unlisted works) and give it a title; it appears at the top of Tutorials on the client site. Up to 50 per site. Videos stay on YouTube (`site_videos` stores only the link's id), play through `youtube-nocookie.com`, and the player only loads when a client presses play.

### Look and feel
A soft, Apple-style layer sits at the end of [src/styles.css](src/styles.css) (search `SOFT / APPLE-STYLE REFINEMENT`): system font (San Francisco on Apple devices, Inter elsewhere), soft greys, hairline borders, rounded cards, pill buttons, frosted header bars and thin quiet scrollbars. Its `:root` tokens change the whole light look; dark mode keeps its navy palette with the same shapes. Mentor accent colours are always kept.

Laptops (1001–1599 px wide) get a compact layout at the end of the same file (search `LAPTOP LAYOUT`): slimmer bars, tighter cards in even columns, and a sidebar that fits every link. Phones and larger screens are not affected.

### Operators and the network
- **Identity:** Deriv exposes no user ID, so an operator is identified by the Deriv accounts they own (`operator_accounts`). Traders who log in on a trader site never become operators.
- **Tree:** the platform **owner** is the root, and every other operator has a parent.
  - **Invite links** (`mwasya.site/?invite=CODE`) place a *new* operator under the inviter.
  - Anyone who signs up without a link goes under the owner.
  - Existing operators can never be moved by an invite.
- **Network page** (`/network`): each operator sees everyone below them. The owner sees everyone and can:
  - search
  - open a person's details (accounts, bots, payments, history)
  - suspend or reactivate them with the **Active / Suspended switch** on each row (a suspended mentor's client site only shows its loading screen until switched back)
  - grant days of access
- **Make yourself the owner** (one time, after logging in to mwasya.site once):
  ```bash
  npm run make-owner -- <YOUR_DERIV_ACCOUNT_ID>     # e.g. ROT91861465
  ```
- **Mentor fees** (`/fees`, owner only): set each mentor's fee (fixed KES, % of commission, or none) and the **Paybill** mentors pay to (`Where mentors pay`). With a Paybill set, it is the only number mentors see; the account number is the mentor's site name unless a fixed one is set. A monthly fee only counts as paid when the owner allows it: **Waiting for your approval** lists every waiting payment from any month, with **Check** (details) and **Allow** (locked until checked). This includes payments Safaricom has confirmed. The M-Pesa prompt uses the `MPESA_*` settings below (`MPESA_TYPE=paybill`).
- **Billing** (`/billing`): M-Pesa STK push. Payments are credited only after Safaricom confirms them, either through the callback (secret key, amount checked, re-verified with an STK query) or by querying Safaricom directly when the callback is late. Each payment is credited exactly once.

### Scale
- All new endpoints run in **one** serverless function (`api/platform.ts`), which shares a warm, pooled Postgres connection.
- The network list is paginated (25 per page), searched on the server, and debounced in the browser.
- The tree walks are indexed on `parent_id` and depth-limited.
- Hundreds or thousands of operators stay fast.

### Security
- **Sessions:** the access token is encrypted in a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax), so no subdomain can plant or read it.
- **Requests:**
  - Every state-changing request is CSRF-checked (Origin must match the host).
  - Every operator request re-checks the database, so a suspension applies instantly.
- **Rate limits** are stored in Postgres, so they work across all servers:
  - login: 20 per 10 minutes per IP
  - M-Pesa prompts: 5 per 10 minutes
  - invite creation: 20 per hour
  - trading-socket links: 60 per minute
- **Audit log:** owner actions, invites and payments are recorded in `audit_log`.
- **Headers:** strict CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, COOP; API responses are `no-store`.
- **Login redirects:** only same-app paths are allowed after login (open-redirect guard). Production dependencies show 0 known vulnerabilities in `npm audit --omit=dev`.

---

## Security rules
- Never ask traders for API tokens or passwords. Passwords are only typed on Deriv's own page (OAuth 2.0 + PKCE).
- Logins request `trade` only. `payment` is requested only when a client opens the Cashier, is stored in a separate
  cookie that expires after 15 minutes, and every withdrawal still needs the code Deriv emails the client.
  Never request `account_manage`.
- Personal access tokens (`pat_…`) are server-only. Never ship them to the browser.
- Secrets live in Vercel environment variables and `.env.local`, never in git.

### How the site protects itself
| Threat | Protection | Where |
|---|---|---|
| Floods (thousands of requests to crash it) | Vercel's platform DDoS protection; then a per-IP **flood guard** on every API endpoint that answers `429` before any database work; then Postgres-backed limits on logins, payments, domains, posting | `api/_lib/burst.ts`, `api/_lib/guard.ts` (`rateLimit`) |
| Stolen logins | Deriv token kept server-side in an AES-256-GCM encrypted, `HttpOnly`, `Secure`, `__Host-` cookie; the browser never sees it | `api/_lib/session.ts` |
| Forged requests from other websites (CSRF) | Every state-changing request must come from the same site (`Origin` check); cookies are `SameSite` | `sameOrigin` in `api/_lib/session.ts` |
| Injected scripts (XSS) | React escapes all text (no raw HTML anywhere); strict Content-Security-Policy; `X-Frame-Options: DENY` | `vercel.json` headers |
| Database injection | Every query uses placeholders (`$1, $2…`), never pasted-in user text | `api/` |
| Malicious uploads | Bot files must be Blockly XML and are rejected if they contain scripts, `<!DOCTYPE>`/entities, frames or event handlers; served only as downloads. Logos must be PNG/JPEG/WebP data, max 200 KB, served sandboxed | `checkXml` in `api/platform.ts`, `db/schema.sql` |
| Someone acting as owner | Owner/mentor role is re-checked in the database on every request; suspended mentors are locked out immediately | `requireOperator` / `requireOwner` in `api/_lib/guard.ts` |
| Vulnerable packages | `npm audit --omit=dev` (0 known vulnerabilities as of 2026-11-05) | |

**If you are under attack:** Vercel dashboard → project → **Firewall** → turn on **Attack Challenge Mode**
(visitors must pass a browser check). Turn it off when traffic is normal again.

## Project structure
```
api/
  auth/            token exchange, session, logout
  deriv/           accounts, one-time WebSocket URL (OTP)
  bots/            Bot Forge CRUD (operators only)
  sites/mine.ts    operator's trader site (create / publish)
  site.ts          which app is this host? + published bots
  platform.ts      me, invites, network, billing (M-Pesa) — one routed function
  _lib/            db pool, session crypto, tenancy, strategy rules
db/schema.sql      Postgres schema (operators + network, bots, sites, invites, payments, settings, audit_log)
scripts/migrate.mjs  applies the schema
src/
  shared/          bot spec + safety validation (browser and API)
  lib/             OAuth, WebSocket client, auto-trading, balance/auth context, tenancy
  components/      app shell (sidebar), run card, UI kit
  pages/           Login, Overview, Bot Forge, Sites, Network, Billing, Settings, Announcements, XML Bots, Landing (/about)
  trader/          client trading site: Bot Builder (Blockly), Quick Bot, Charts, D-Circles, Signals, Manual Trader, Daily Plan, price bar
design/            clickable UI prototype
```

## Database
- Tables are defined in [db/schema.sql](db/schema.sql). Run `npm run db:migrate` after any schema change; it's safe to rerun.
- To browse the data in VS Code, install the **PostgreSQL** extension (`ms-ossdata.vscode-pgsql`), choose **Add connection**, and paste `DATABASE_URL` from `.env.local`.

---

Built on the Deriv API. Trading carries risk; bots do not guarantee profit.
