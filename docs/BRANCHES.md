# Branches: production vs work in progress

| Branch | What it is | Deploys to |
|---|---|---|
| `master` | **Production** — what mentors and clients use | mwasya.site, every `<name>.mwasya.site` and mentors' own domains |
| `dev` | **Work in progress** — every change goes here first | Test address: `https://mwasyasite-git-dev-dennis-muasyas-projects.vercel.app` |

Rule: **never commit straight to `master`.** Work on `dev`, check the test address, then release.

---

## Everyday workflow

```bash
git switch dev                 # 1. work on dev
# ...make changes...
npx tsc -b && npm run build    # 2. check it compiles
git add -A && git commit -m "What changed"
git push                       # 3. Vercel builds the test address (about 1 minute)
```

4. Open the test address and check the change.
5. Release it:

```bash
git switch master
git merge dev                  # bring the checked changes into production
git push                       # mwasya.site and all client sites update
git switch dev                 # back to work
```

**Undo a bad release** (puts production back to the previous version, nothing is lost):
Vercel dashboard → project → **Deployments** → the previous Production deployment → **⋯ → Promote to Production**.
Then fix the problem on `dev`.

**Urgent fix straight to production** (rare): make it on `dev`, then `git switch master && git merge dev && git push`.

---

## One-time setup (so the test address never touches live data)

These steps are done in the Neon, Vercel and Deriv dashboards because they involve passwords and secrets.

### 1. A separate test database (Neon)
Right now the test address would use the **live** database. Give it its own copy:
1. Neon console → your project → **Branches → Create branch** → name `dev` (copies the live data at that moment).
2. Open the `dev` branch → **Connection details** → copy its connection string.
3. Vercel → project → **Settings → Environment Variables** → `DATABASE_URL` → **Edit** →
   untick **Preview** on the existing one (keep Production), then **Add** a new `DATABASE_URL` for **Preview** only with the `dev` branch string.
   Do the same for `DATABASE_URL_UNPOOLED` if you use it.

### 2. Login settings for the test address (Vercel → Environment Variables, environment = Preview)
| Name | Value |
|---|---|
| `SESSION_SECRET` | a **new** random value (`openssl rand -base64 48`), not the production one |
| `DERIV_APP_ID` | same as production (Mwasya's Deriv app) |
| `VITE_DERIV_APP_ID` | same as production |
| `DERIV_REDIRECT_URI` | `https://mwasyasite-git-dev-dennis-muasyas-projects.vercel.app/callback` |

Leave M-Pesa and `VERCEL_TOKEN` **Production only**, so tests can never charge anyone or buy domains.

### 3. Deriv app
developers.deriv.com → Mwasya's app → **Redirect URIs** → add
`https://mwasyasite-git-dev-dennis-muasyas-projects.vercel.app/callback`

### 4. Redeploy the test address
Vercel → **Deployments** → latest `dev` deployment → **⋯ → Redeploy**.

### 5. (Optional) Protect `master` on GitHub
GitHub → repo → **Settings → Branches → Add rule** → `master` → tick **Require a pull request before merging**.
Then releases go through a pull request from `dev` → `master`.

---

## Notes
* Client trading sites (`<name>.mwasya.site`) only exist on production; on the test address you test the studio,
  and the client site through **Sites → Preview as client**.
* Database changes (`db/schema.sql`): run `npm run db:migrate` against the **dev** database first
  (put the dev connection string in `.env.local` while testing), then against production when releasing.
