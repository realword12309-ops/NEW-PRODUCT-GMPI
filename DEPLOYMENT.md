# Deploying the GMPI New Product Cascading System Online (Render)

This guide takes the working local application and publishes it at **one public URL**
that authorized users can open from any device, anywhere. The application, its design,
and all features stay exactly as they are — only the hosting, database, and file
storage change.

**Architecture:** one combined Node.js server (frontend + backend + PDF generation)
deployed as a single Render **Web Service**, backed by your **existing Render PostgreSQL
database (`gmpi-database`, PostgreSQL 18, Oregon)**. The Blueprint creates only the web
service — it never creates, modifies, or deletes a database.
Product images are stored inside PostgreSQL, so they survive restarts and redeploys
with no disk or third-party storage account needed.

---

## What you need before starting

1. A **GitHub account** — https://github.com/signup
2. A **Render account** — https://dashboard.render.com/register (you can sign in with GitHub)
3. Your chosen **admin username and password** for the online system (password: 8+ characters).
   You will type these into Render once; they are never written into the code.

> **Cost note (important):** The included `render.yaml` uses Render's **free** plans.
> - Free web services sleep after ~15 minutes of inactivity; the first visit after a pause
>   takes ~50 seconds to wake. The site stays online, just slow to wake.
> - **Free Render PostgreSQL databases expire 30 days after creation.** If your existing
>   `gmpi-database` is on the free plan, upgrade it to the paid **Basic** plan before its
>   30th day (Render dashboard → gmpi-database → Upgrade) or the data is deleted. For an
>   always-on production system, also upgrade the web service to the **Starter** plan.
>   Check https://render.com/pricing for current prices.

---

## Step 1 — Upload the project to GitHub

Open a terminal **in the project folder** (the folder containing `server.js`):

```bash
git init
git add .
git commit -m "GMPI New Product Cascading System - production ready"
```

Then on GitHub: **New repository** → name it e.g. `gmpi-cascading` → set it to
**Private** (recommended) → **Create repository**. GitHub shows the push commands:

```bash
git remote add origin https://github.com/YOUR-USERNAME/gmpi-cascading.git
git branch -M main
git push -u origin main
```

The `.gitignore` already excludes `node_modules/`, the local database (`data/`),
uploaded files (`uploads/`), and any `.env` — your local data and secrets are **not**
uploaded. Your existing records are moved to the online database in Step 5 instead.

## Step 2 — Connect GitHub to Render (Blueprint deploy)

1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect your GitHub account if prompted, then select the `gmpi-cascading` repository.
3. Render reads `render.yaml` and shows the **one** resource it will create:
   - **gmpi-cascading** (web service, Oregon — same region as your database)
   Your existing `gmpi-database` is **not** part of the Blueprint; Render will not
   create, change, or delete it.
4. Render prompts for the three values marked "sync: false":
   - `DATABASE_URL` → open your existing **gmpi-database** → **Connect** → copy the
     **Internal Database URL** and paste it here. (Internal works because the web
     service is in the same Oregon region. Never commit this value to GitHub.)
   - `ADMIN_USERNAME` → the admin username you chose
   - `ADMIN_PASSWORD` → the admin password you chose
5. Click **Apply** (or **Deploy Blueprint**). Render generates `SESSION_SECRET`
   automatically, builds (`npm ci`) and starts (`node server.js`) the app.
6. Wait until the web service shows **Live** (green). The health check is `/api/health`.

> If you already created the web service from an earlier Blueprint attempt: push the
> updated `render.yaml`, then use the Blueprint's **Sync** action (or the service's
> **Environment** tab) to add `DATABASE_URL` with the Internal Database URL. If Render
> asks about removing the old `gmpi-db` Blueprint resource, that refers only to the
> database the failed Blueprint tried to create — your existing `gmpi-database` is
> unmanaged by the Blueprint and is not affected.

## Step 3 — Get your public URL

On the web service page, the URL is shown at the top, in the form:

```
https://gmpi-cascading.onrender.com
```

(If the name was taken, Render appends a suffix — use the exact URL shown.)
Open it: you should see the burgundy-and-gold **sign-in page**. Sign in with the
`ADMIN_USERNAME` / `ADMIN_PASSWORD` you entered in Step 2.

## Step 4 — Environment variable reference

| Variable | Where the value comes from | Notes |
|---|---|---|
| `DATABASE_URL` | **You paste it** — gmpi-database → Connect → **Internal Database URL** | Stored securely by Render (sync: false). Never commit it or put it in frontend code. |
| `SESSION_SECRET` | **Render, automatically** (generated) | Signs login sessions. Do not edit. |
| `ADMIN_USERNAME` | **You chose it** during Blueprint setup | Creates the first admin only when no users exist. |
| `ADMIN_PASSWORD` | **You chose it** during Blueprint setup | After the first successful deploy you may delete this variable from the dashboard — the account already exists in the database. |
| `NODE_ENV` | `production` (preset) | Required. |
| `PUBLIC_BASE_URL` | Optional — only if you attach a custom domain | e.g. `https://cascading.yourcompany.com`. Makes shared store links use your domain. |
| External Database URL | **Render dashboard → gmpi-database → Connect → External Database URL** | Used only for Step 5 migration from your PC. Keep it secret. |

## Step 5 — Move your existing records to the online database (one time)

Your PC still has the original local data (`data/app.db` and `uploads/`). This copies
everything — announcements, products, pricing, TO/FROM, stores, acknowledgments,
user accounts, and product images — into the online PostgreSQL:

1. In Render: **gmpi-database** → **Connect** → copy the **External Database URL**.
2. In a terminal in the project folder on your PC:

   **Windows (Command Prompt):**
   ```cmd
   set DATABASE_URL=PASTE-EXTERNAL-URL-HERE&& npm run migrate:pg
   ```

   **Windows (PowerShell):**
   ```powershell
   $env:DATABASE_URL="PASTE-EXTERNAL-URL-HERE"; npm run migrate:pg
   ```

3. You should see per-table counts (`announcements: 2 inserted`, `images: N copied`, etc.)
   and `Migration complete.`
4. Refresh the public website and sign in — your announcements, products, images, and
   stores are all there. The script is idempotent: running it again skips rows that
   already exist (it never overwrites online edits).

## Step 6 — Add more authorized users (optional)

Each person who should manage announcements needs an account:

```cmd
set DATABASE_URL=PASTE-EXTERNAL-URL-HERE&& set USER_PASSWORD=TheirChosenPassword&& node scripts/create-user.js their.username
```

(PowerShell: `$env:DATABASE_URL="..."; $env:USER_PASSWORD="..."; node scripts/create-user.js their.username`)

Re-running with an existing username resets that user's password. Share usernames and
passwords with your team through a secure channel — never commit them to GitHub.

Store staff do **not** need accounts: they open the public announcement link
(`/view/...`) and acknowledge receipt, exactly as before.

## Step 7 — Test from another device (required)

Use a phone on **mobile data** (not your Wi-Fi) or a different computer:

1. Open `https://YOUR-SERVICE.onrender.com` → sign-in page appears → sign in.
2. Dashboard loads with your real announcements, products, and stores.
3. Open an announcement → download **Sales Team**, **Stores**, **Our Valued Customers**
   PDFs and **Download All Three (ZIP)**. Check: correct TO recipient, your FROM value,
   correct pricing columns per recipient, product images, and page layout.
4. Create a test announcement from the phone, then check it appears on your laptop —
   this proves everyone shares one online database.
5. Open the announcement's public `/view/...` link while signed out → the store page
   works without login, shows only Packaging / UoM / Retail Price, and acknowledgment
   is recorded back in the admin dashboard.
6. Delete the test announcement when done.

## Updating the app later

Edit locally, then:

```bash
git add .
git commit -m "describe the change"
git push
```

Render auto-deploys every push to `main`. The database and images are untouched by
deployments.

## Troubleshooting

- **Deploy fails at build:** Render dashboard → service → **Logs** tab shows the npm
  error. Confirm `package-lock.json` was committed (it must be).
- **"Application failed to respond" / health check failing:** check Logs for
  `FATAL: DATABASE_URL...` or `FATAL: SESSION_SECRET...` — `SESSION_SECRET` is generated
  by the Blueprint; `DATABASE_URL` must be set by you (Step 2). Add missing values from
  the table above, then redeploy.
- **Login says invalid credentials:** the admin is only created on first boot when the
  users table is empty. If you set `ADMIN_USERNAME`/`ADMIN_PASSWORD` after the first
  deploy, use `scripts/create-user.js` (Step 6) or trigger **Manual Deploy → Clear
  build cache & deploy** after setting the variables on a fresh database.
- **Migration cannot connect:** use the **External** Database URL (not Internal), and
  confirm your existing gmpi-database's IP allow list permits connections from your PC
  (Render's default is `0.0.0.0/0`; check under gmpi-database → Connect / Access Control).
- **First visit is slow:** the free web service is waking from sleep (~50 s). Upgrade to
  Starter for always-on.
- **Database expired (free plan):** upgrade gmpi-database to Basic before day 30, then re-run
  Step 5 if the data was lost.