# Mwasya

The operator platform for Deriv trading brands: branded sites, Bot Forge and Telegram signals.

## Stack
React 18 · TypeScript · Vite · React Router · Zustand · Vercel serverless functions (`/api`).

## Getting started
```bash
npm install
cp .env.example .env.local   # fill in values — never commit this file
npm run dev
```
The `/api` functions run on Vercel. Locally, use `npx vercel dev` to run the frontend and API together.

## Environment variables
| Name | Where | Notes |
|---|---|---|
| `VITE_DERIV_APP_ID` | browser | Your Deriv app ID (public) |
| `DERIV_APP_ID` | server | Same app ID, used for the token exchange |
| `DERIV_REDIRECT_URI` | server | Must exactly match the redirect URI registered on Deriv, e.g. `https://mwasya.site/callback` |
| `SESSION_SECRET` | server | 32+ random bytes, base64 |
| `DATABASE_URL` | server | Postgres connection string (pooled URL in production). Run `npm run db:migrate` after setting it. |

## How Deriv login works (secure by design)
1. `/app` → **Log in with Deriv** builds a PKCE challenge and `state`, then redirects to `auth.deriv.com/oauth2/auth` with the **`trade` scope only**.
2. Deriv redirects to `/callback?code=…&state=…`. The page verifies `state`, strips the code from the URL and POSTs it to `/api/auth/token`.
3. The server exchanges the code (with the PKCE verifier) for an access token and stores it in an **AES-256-GCM encrypted, HttpOnly, Secure cookie**. The token never reaches browser JavaScript.
4. `/api/deriv/otp` uses that token to get a **one-time WebSocket URL** for the selected account. The browser connects to it directly for balance and trading.
5. Market data uses Deriv's public WebSocket (no login).

Deriv issues no refresh tokens. On expiry or a 401, the user simply logs in again.

## Security rules
- Never ask traders for API tokens or passwords.
- Never request `payment` or `account_manage` scopes.
- Personal access tokens (`pat_…`) are server-only. Never ship them to the browser.
- Secrets live in Vercel environment variables, never in git.

## Structure
```
api/            Vercel functions: auth/*, deriv/accounts, deriv/otp, bots (CRUD)
db/schema.sql   Postgres schema (operators, bots, bot_runs)
src/shared/     Bot spec + safety validation, shared by browser and API
src/lib/        PKCE, Deriv OAuth client, WebSocket client
src/store/      Site settings (markup capped at 3%)
src/pages/      Landing, Setup wizard, Callback, Trader dashboard
design/         Clickable UI prototype source
```


## Bot Forge (`/forge`)
Bots run on Deriv's servers through the `auto_*` API ([docs](https://developers.deriv.com/llms/auto-start.md)). Mwasya only builds, checks and starts them.
- **Strategies:** `fixed` (Mwasya's own: martingale with `max_stake` equal to `initial_stake`), `martingale` and `dalembert`. Deriv's rules come from `auto_list_strategies` at runtime. Its docs example is wrong: money fields are strings.
- **Safety:** [src/shared/botSpec.ts](src/shared/botSpec.ts) runs in the browser for live feedback and on the server before every save. Escalating strategies must set a max stake, which can't exceed the stop loss. The stop loss is capped at 1000, max trades at 500 and the martingale multiplier at 3.
- **Operators:** Deriv exposes no user id, so at login an operator is matched by the Deriv accounts they own (`operator_accounts`). Sessions created before the database existed are asked to log in again.

## Database
1. Create a Postgres database. Neon (through Vercel → Storage) works well on serverless. Local Postgres also works.
2. Put `DATABASE_URL` in `.env.local` and in Vercel's environment variables.
3. `npm run db:migrate`. The script is idempotent.
4. To browse the data in VS Code, use the **PostgreSQL** extension (`ms-ossdata.vscode-pgsql`): Add connection, then paste the same URL.
