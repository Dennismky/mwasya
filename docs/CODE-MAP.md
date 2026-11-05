# Mwasya code map — where to change what

Search the code for **`EDIT HERE`** to jump straight to the most common settings.
Every file listed below is relative to the project folder.

---

## 1. The big picture

| Part | Who uses it | Main folder |
|---|---|---|
| **Studio** (mwasya.site) | You (owner) and mentors | `src/pages/`, `src/components/AppShell.tsx` |
| **Client trading site** (`<name>.mwasya.site` or the mentor's domain) | Clients of a mentor | `src/trader/` |
| **Login card** (both) | Everyone | `src/components/AuthCard.tsx` |
| **Server (API)** | Both, behind the scenes | `api/` |
| **Database tables** | Server | `db/schema.sql` |
| **All styling (colours, layout, animation)** | Both | `src/styles.css` |

One build serves both sites. `src/App.tsx` decides which one to show from the web address.

---

## 2. Client trading site (`src/trader/`)

| What you see | File | Notes |
|---|---|---|
| Header, tabs, phone ☰ menu, results panel, bell, risk button, light/dark switch | `TraderApp.tsx` | Tabs list: `EDIT HERE` near the top. Risk popup text: `EDIT HERE` near the bottom. |
| Login / welcome page of a client site | `SiteLanding.tsx` (uses `src/components/AuthCard.tsx`) | |
| Dashboard tab | `TraderDashboard.tsx` | Tip of the day list is at the top. |
| Bot Builder (blocks workspace, toolbar, Quick strategy, Run bar) | `BotBuilder.tsx` | |
| Block editor (Blockly) | `BlockEditor.tsx` | Loads any Deriv Bot XML. |
| Our block definitions + Quick strategy → blocks | `blocks.ts` | Block colours: `EDIT HERE`. |
| Runs a bot block by block | `xmlRunner.ts` | Add support for a new block type in `exec()` (actions) or `eval()` (values). |
| Bot engine (run/stop, trades, Journal) | `botEngine.ts` | Shared by every page, so bots keep running across tabs. |
| Reads a bot file's stake / martingale / limits | `xmlBot.ts` | |
| Summary / Transactions / Journal panel | `RunPanel.tsx` | |
| Manual Trader | `ManualTrader.tsx` + chart `LiveChart.tsx` | Chart colours: `EDIT HERE` in `LiveChart.tsx`. |
| Charts tab | `Charts.tsx` | Colours: `EDIT HERE`. |
| Signals (strategy desk + board) | `Signals.tsx` | Strategy cards: `EDIT HERE`. |
| D-Circles (digit circles) | `Analysis.tsx` | |
| Daily Plan | `RiskCalculator.tsx` | Presets: `EDIT HERE`. |
| Tutorials | `Tutorials.tsx` | Guides: `EDIT HERE`. |
| Free Bots | `FreeBots.tsx` | |
| Reports | `Reports.tsx` | |
| Quick Bot | `QuickBot.tsx` | |
| Account switcher (real/demo, balances) | `AccountSwitcher.tsx` | |
| Cashier (Manage funds) | `Cashier.tsx` (server: `api/_lib/cashier.ts`) | |
| **Notifications bell (announcements)** | `Bell.tsx` | Start position: `EDIT HERE`. |
| Price ticker strip | `Ticker.tsx` | |
| Live tick data helpers, market list | `ticks.ts` | `SYMBOLS` = markets shown in pickers. |

## 3. Studio (mwasya.site)

| What you see | File |
|---|---|
| Sidebar menu, top bar | `src/components/AppShell.tsx` (`EDIT HERE` on the menu) |
| Login | `src/pages/Login.tsx` + `src/components/AuthCard.tsx` |
| Overview / dashboard (site shortcuts) | `src/pages/Dashboard.tsx` |
| My websites, site wizard, domains | `src/pages/sites/` |
| **Announcements (mentor posts)** | `src/pages/Announcements.tsx` |
| Network (mentors, clients count, Show more) | `src/pages/Network.tsx` |
| Commissions | `src/pages/Commissions.tsx` |
| Mentor fees (owner) | `src/pages/Fees.tsx` |
| Billing (M-Pesa) | `src/pages/Billing.tsx` |
| Yellow fee bell | `src/components/DuesBell.tsx` |
| Settings | `src/pages/Settings.tsx` |
| Languages (English / Swahili / French) | `src/lib/i18n.ts` |
| Site templates and switchable tools | `src/shared/templates.ts` (`EDIT HERE`) |

## 4. Server (`api/`)

| Job | File |
|---|---|
| Studio API: sites, network, billing, fees, domains, **announcements**, XML bots, support | `api/platform.ts` (one file, many sections; search `async function`) |
| Client site info sent to the browser (name, colours, tools, **announcements**) | `api/site.ts` |
| Deriv login (code → token), client counting | `api/auth/token.ts` |
| Deriv accounts, reset demo, cashier actions | `api/deriv/accounts.ts` |
| Login cookies (normal + 15-minute cashier) | `api/_lib/session.ts` |
| Which site a web address belongs to | `api/_lib/tenant.ts` |
| Rate limits, owner/mentor checks, audit log | `api/_lib/guard.ts` |
| Domain registered/paid check | `api/_lib/domainCheck.ts` |
| M-Pesa | `api/_lib/mpesa.ts` |

---

## 5. Recipes

### Add or change a notification (announcement) feature
1. **Database**: the table is `site_announcements` in `db/schema.sql`. To add a column (e.g. a link), add a line like
   `alter table site_announcements add column if not exists link text;` at the end of the file, then run `npm run db:migrate`.
2. **Mentor posting** (save it): `api/platform.ts` → search `EDIT HERE: announcements API`. Read the new field from `req.body`, add it to the `insert`.
3. **Mentor form** (type it): `src/pages/Announcements.tsx` → add an input and send it in `post()`.
4. **Clients receive it**: `api/site.ts` → `EDIT HERE` → add the column to the `select`.
   Also add it to the `Announcement` type in `src/lib/tenant.ts`.
5. **Clients see it**: `src/trader/Bell.tsx` → the `an-card` block shows title, message and time. Styling: search `an-card` in `src/styles.css`.
6. Clients check for new announcements every **60 seconds** (`TraderApp.tsx`, search `60_000`).

### Add a tab to the client site
1. Create `src/trader/MyPage.tsx` (copy a small page such as `Tutorials.tsx`).
2. `src/trader/TraderApp.tsx`: add it to `TABS` (`EDIT HERE`) and add a `<Route path="my-page" …>` next to the others.
3. If mentors should be able to switch it off, give it a `feature` id and add that id to `SITE_FEATURES` in `src/shared/templates.ts`.

### Add a strategy card to Signals
`src/trader/Signals.tsx` → `EDIT HERE` above `STRATEGIES` → add a line such as
`{ id: 'over3', name: 'Over 3 Engine', kind: 'over', barrier: 3, note: 'Digits above 3' },`

### Change colours
* Mwasya navy / blue and global colours: top of `src/styles.css` (`:root`).
* Dark mode colours: search `[data-theme="dark"]` and `.tp-dark` in `src/styles.css`.
* Charts: `EDIT HERE` in `src/trader/Charts.tsx` and `src/trader/LiveChart.tsx`.
* Bot Builder blocks: `EDIT HERE` in `src/trader/blocks.ts`.

### Change risk / legal wording
* Client popup: `src/trader/TraderApp.tsx` (`EDIT HERE`).
* Client login footer: `src/trader/SiteLanding.tsx` (`legal=`).
* Studio footer text: `src/lib/i18n.ts` (`legal.risk`).

---

## 6. Debugging

| Problem | Where to look |
|---|---|
| A page shows "This page hit a problem" | Browser console (F12 → Console) shows the error and file. The guard is `src/components/PageBoundary.tsx`. |
| A bot stops or misbehaves | Client site → results panel → **Journal**: every step, buy and error is logged there (`botEngine.ts`, `xmlRunner.ts`). |
| Server error / API fails | Vercel dashboard → project → **Logs**, or `vercel logs mwasya.site` in the terminal. Server errors are logged with `console.error`. |
| Database question | `db/schema.sql` lists every table. Apply changes with `npm run db:migrate` (safe to run again). |
| Check types before pushing | `npx tsc -b` (no output = OK), then `npm run build`. |

Every push to `master` on GitHub deploys to mwasya.site automatically.
