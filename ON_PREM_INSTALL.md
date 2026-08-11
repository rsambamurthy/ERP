# On-Premises Installation & Operations Manual

Audience: the IT team standing this ERP up on infrastructure you control,
instead of Railway (backend) + Vercel (frontend), which is how it's
currently deployed. Everything here works from the same codebase — nothing
in the app is Railway/Vercel-specific, those are just where the reference
deployment happens to run today.

This document is the authoritative install sequence. `backend/README.md`'s
own "Local development" quick-start only lists migrations through
`migration_014` (it predates most of what's in `db/` today) — use the list
in this document, not that one, for the full migration set.

---

## 1. Architecture overview

Three components, all stateless except the database:

| Component | Tech | Talks to | Default port |
|---|---|---|---|
| **Database** | PostgreSQL 13+ | — | 5432 |
| **Backend** | Node.js + Express + Prisma | Postgres | 4000 |
| **Frontend** | Next.js 14 (App Router) | Backend, over HTTP(S) | 3000 |

The frontend is a server-rendered Next.js app, not a static export — it
needs its own long-running Node process, same as the backend. There is
**no Docker setup in this repo today**; both apps run as plain Node
processes, managed by systemd (recommended below) or pm2. Containerizing
is straightforward if your team prefers it, but you'd be writing the
Dockerfiles yourself — none exist here yet.

The frontend calls the backend directly using whatever base URL you give
it at build time (`NEXT_PUBLIC_API_URL`) — there's no `/api` prefix baked
into the backend's own routes (`/auth/login`, `/accounts`, `/journal`,
etc. are mounted at the root). The simplest topology is to put the backend
on its own subdomain (e.g. `api.yourcompany.com`) so `NEXT_PUBLIC_API_URL`
is just that origin with nothing else to rewrite. A single-domain,
path-based setup (`yourcompany.com/api/*`) also works but needs an nginx
rewrite rule — see §7.

### Suggested sizing (starting point, not a load-tested number)

No load testing has been done against this app to produce a hard sizing
figure — treat the below as a reasonable starting point for a single
MSME-scale org and adjust from real usage:

- **Small (single org, <50 concurrent users):** one server, 2 vCPU / 4 GB
  RAM is enough to run Postgres + backend + frontend together.
- **Medium (multiple orgs, or heavier reporting/PDF/bulk-upload use):**
  split the database onto its own host (2 vCPU / 4 GB, sized by data
  volume) and the app tier onto another (2 vCPU / 4 GB for backend +
  frontend together).

---

## 2. Prerequisites

- **OS:** any modern Linux distribution (Ubuntu 22.04 LTS is what these
  instructions assume; adjust package manager commands for others).
- **Node.js 20.x LTS.** The codebase's `@types/node` pins to `20.14.x`;
  stay on Node 20 rather than jumping to a newer major until that's
  bumped and verified.
- **PostgreSQL 13 or later.** The schema calls `gen_random_uuid()` on
  every primary key without an explicit `CREATE EXTENSION pgcrypto` —
  that function has been built into Postgres core since v13. On an older
  Postgres, run `CREATE EXTENSION IF NOT EXISTS pgcrypto;` yourself before
  the migrations, or just use 13+.
- **Outbound internet access during install**, at least once: `npm
  install` pulls packages from the npm registry, and the backend's
  `postinstall` hook runs `prisma generate`, which downloads Prisma's
  query-engine binary from Prisma's CDN. If your servers are fully
  air-gapped, you'll need to either open a temporary egress rule for
  install, or build on a machine with internet access and ship the
  resulting `node_modules`/`.prisma` folders over.
- **A reverse proxy** for TLS termination (nginx is assumed below; Apache
  or Caddy work the same way in principle).
- **A domain (or subdomains)** pointed at your server(s), and a TLS
  certificate (Let's Encrypt via certbot is the easy path).
- **git**, to pull the code (`https://github.com/rsambamurthy/ERP`,
  branch `main`).

---

## 3. Get the code

```bash
git clone https://github.com/rsambamurthy/ERP.git
cd ERP
```

Layout:

```
db/        SQL schema + migrations (source of truth for the DDL)
backend/   Node + Express + Prisma API
frontend/  Next.js app
docs/      design spec (registration module)
ROADMAP.md build history / design rationale for every feature
```

---

## 4. Database setup

### 4.1 Create the database

```bash
sudo -u postgres psql -c "CREATE ROLE erp_app WITH LOGIN PASSWORD 'choose-a-strong-password';"
sudo -u postgres psql -c "CREATE DATABASE erp OWNER erp_app;"
```

Set `DATABASE_URL` (used in the next step and in the backend's `.env`)
to something like:

```
postgresql://erp_app:choose-a-strong-password@localhost:5432/erp
```

### 4.2 Run the schema and every migration, in this exact order

`registration_schema_v2.sql` is the base schema (not `prisma migrate` —
Prisma's schema language can't express everything in it, like the
`trg_lock_org_domains` trigger and several CHECK constraints, so this SQL
file is the real source of truth; `backend/prisma/schema.prisma` mirrors
it purely so the backend gets a typed client).

```bash
export DATABASE_URL="postgresql://erp_app:choose-a-strong-password@localhost:5432/erp"

psql "$DATABASE_URL" -f db/registration_schema_v2.sql
psql "$DATABASE_URL" -f db/migration_002_accounting.sql
psql "$DATABASE_URL" -f db/migration_003_users_admin.sql
psql "$DATABASE_URL" -f db/migration_004_module_subscriptions.sql
psql "$DATABASE_URL" -f db/migration_005_menu_config.sql
psql "$DATABASE_URL" -f db/migration_006_sales_purchase_inventory.sql
psql "$DATABASE_URL" -f db/migration_007_user_name_and_bp_code.sql
psql "$DATABASE_URL" -f db/migration_008_sales_purchase_returns.sql
psql "$DATABASE_URL" -f db/migration_009_custom_roles.sql
psql "$DATABASE_URL" -f db/migration_010_user_management.sql
psql "$DATABASE_URL" -f db/migration_011_custom_role_access_control.sql
psql "$DATABASE_URL" -f db/migration_012_employee_details.sql
psql "$DATABASE_URL" -f db/migration_013_branch_crud.sql
psql "$DATABASE_URL" -f db/migration_014_discount_gst.sql
psql "$DATABASE_URL" -f db/migration_015_journal_ux.sql
psql "$DATABASE_URL" -f db/migration_016_mpin.sql
psql "$DATABASE_URL" -f db/migration_017_company_master.sql
psql "$DATABASE_URL" -f db/migration_018_foreign_currency.sql
psql "$DATABASE_URL" -f db/migration_019_lut_bond.sql
psql "$DATABASE_URL" -f db/migration_020_shipping_bill.sql
psql "$DATABASE_URL" -f db/migration_021_customs_duty.sql
psql "$DATABASE_URL" -f db/migration_022_purchase_orders.sql
psql "$DATABASE_URL" -f db/migration_023_goods_receipt_notes.sql
psql "$DATABASE_URL" -f db/migration_024_bill_approval.sql
psql "$DATABASE_URL" -f db/migration_025_sales_orders.sql
psql "$DATABASE_URL" -f db/migration_026_currency_master.sql
psql "$DATABASE_URL" -f db/migration_027_po_so_currency.sql
```

Stop and fix the error before continuing if any single file fails —
several later migrations `ALTER` tables/columns the earlier ones create,
so running out of order will fail loudly rather than silently corrupt
anything.

`db/create_platform_admin.sql` is **not** part of this sequence — it's an
older, alternate way to create a platform admin directly in SQL. Use the
`npm run create-admin` script in §5.4 instead; it's the maintained path.

### 4.3 Seed reference data

Domain types (Trading/Manufacturing), module list, and Chart-of-Accounts
templates — one-time, from the backend once its dependencies are
installed (§5):

```bash
cd backend
npx prisma db seed
```

Safe to re-run; it upserts by natural key.

---

## 5. Backend setup

```bash
cd backend
npm install                # also runs `prisma generate` via postinstall
cp .env.example .env
```

### 5.1 Environment variables (`backend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Same connection string as §4.1. |
| `PORT` | No (default `4000`) | What the Express server listens on. |
| `JWT_SECRET` | Yes | A long random string — this signs every login/session token. Generate one with `openssl rand -base64 48`. Treat it like a password; rotating it invalidates every existing session. |
| `EXPOSE_DEV_OTP` | No | **Read §5.2 before going live — this is a real gap, not a cosmetic flag.** |
| `NODE_ENV` | No | Set to `production` in production — affects a couple of error-verbosity checks in the code. |

### 5.2 Important gap to close before go-live: OTP delivery

Signup, password reset, and M-PIN setup all generate a one-time password
(OTP), but **there is currently no SMS or email provider wired up to
actually deliver it.** In development, the API returns the OTP directly
in the JSON response (`devOtp`) so you can test the flow without a real
provider. `EXPOSE_DEV_OTP=false` turns that field off, but turning it off
without wiring a real provider just makes those flows silently unusable —
users would never receive their OTP by any channel.

Before a production go-live with real end users, someone needs to add an
SMS/email integration (Twilio, AWS SES/SNS, MSG91, etc.) at the two or
three call sites in `backend/src/routes/auth.ts` that currently just
return `devOtp`. This isn't an on-prem-specific task — the Railway
deployment has the same open gap today — but it's worth flagging clearly
here since it's easy to miss until real users can't log in.

### 5.3 Build

```bash
npm run build     # prisma generate && tsc  →  dist/
```

### 5.4 Create your first platform admin

The platform admin is a superuser not tied to any org — used to
provision/manage organizations, toggle subscriptions, and read the audit
trail. There's no signup UI for this role by design; create it directly:

```bash
npm run create-admin -- --email you@yourcompany.com --password "something long"
```

Safe to re-run against an existing email — it just promotes that user.

### 5.5 Run it

For a one-off manual check:

```bash
npm start          # runs dist/index.js
```

`GET http://localhost:4000/health` should return `{ "ok": true }`.

For real operation, put it under a process supervisor — see §6.

---

## 6. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local
```

### 6.1 Environment variables (`frontend/.env.local`)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Full base URL of the backend, no trailing slash — e.g. `https://api.yourcompany.com`. This gets **baked into the JavaScript bundle at build time** (it's a `NEXT_PUBLIC_` var), so if it changes, you must rebuild, not just restart. |

### 6.2 Build

```bash
npm run build
```

### 6.3 Run it

```bash
npm start           # next start, defaults to port 3000
```

For real operation, put it under a process supervisor too — see §6.4.

### 6.4 Process management (systemd — recommended)

Two unit files, one per app. Adjust `User`, paths, and `Environment=` to
match your server.

`/etc/systemd/system/erp-backend.service`:

```ini
[Unit]
Description=ERP backend
After=network.target postgresql.service

[Service]
Type=simple
User=erp
WorkingDirectory=/opt/erp/backend
EnvironmentFile=/opt/erp/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/erp-frontend.service`:

```ini
[Unit]
Description=ERP frontend
After=network.target erp-backend.service

[Service]
Type=simple
User=erp
WorkingDirectory=/opt/erp/frontend
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now erp-backend erp-frontend
sudo systemctl status erp-backend erp-frontend
journalctl -u erp-backend -f      # tail logs
```

(pm2 works too — `pm2 start dist/index.js --name erp-backend` and `pm2
start npm --name erp-frontend -- start` — if your team already standardizes
on it elsewhere. systemd is shown as the default here because it needs no
extra tooling on a bare Linux box.)

---

## 7. Reverse proxy / HTTPS

Example nginx config putting the backend on its own subdomain (the
simplest option — no path rewriting needed) and the frontend on the root
domain, both terminated with Let's Encrypt certs.

```nginx
# /etc/nginx/sites-available/erp-backend
server {
    listen 80;
    server_name api.yourcompany.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# /etc/nginx/sites-available/erp-frontend
server {
    listen 80;
    server_name yourcompany.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/erp-backend /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/erp-frontend /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d yourcompany.com -d api.yourcompany.com
```

Then set `NEXT_PUBLIC_API_URL=https://api.yourcompany.com` in the
frontend's `.env.local` and rebuild (§6.2) before this takes effect.

If you'd rather keep everything on one domain (`yourcompany.com/api/*`),
add a second `location /api/ { proxy_pass http://127.0.0.1:4000/; }`
block to the frontend server instead, set
`NEXT_PUBLIC_API_URL=https://yourcompany.com/api`, and note that the
backend's own routes have no `/api` prefix — nginx's trailing slash on
`proxy_pass` is what strips it back off before forwarding.

---

## 8. First-run checklist

1. Confirm `GET https://api.yourcompany.com/health` returns `{"ok":true}`.
2. Log in as the platform admin created in §5.4 at
   `https://yourcompany.com/login` — should land on `/admin`.
3. From there, either provision your first real organization through the
   normal `/register` signup wizard (email/OTP → domain selection →
   auto-provision), or check the platform admin console for a way to
   create one directly, depending on what's exposed there at the time
   you're reading this.
4. Once an org exists: log in as its OWNER, check **Settings → Chart of
   Accounts** looks populated (seeded automatically at signup from
   `coa_templates`), and create at least one more team member to confirm
   `POST /auth/register`-adjacent flows work end to end.
5. Post one real transaction (a journal entry or a Sales Invoice) to
   confirm the whole DB → backend → frontend path is wired correctly.

---

## 9. Backup & restore

Everything durable lives in Postgres — the app servers themselves are
stateless and disposable.

**Backup** (run on a schedule, e.g. nightly via cron):

```bash
pg_dump "$DATABASE_URL" -F c -f "/backups/erp_$(date +%F).dump"
```

Keep enough history to satisfy your own retention policy; this app has
no built-in backup rotation, so that's on your cron/retention script.

**Restore** (to a fresh, empty database):

```bash
createdb -U postgres erp_restored
pg_restore -d "postgresql://erp_app:PASSWORD@localhost:5432/erp_restored" /backups/erp_2026-08-11.dump
```

There's no file-storage component to separately back up today — uploaded
attachments (e.g. journal entry attachments) are stored however
`backend/src/lib/upload.ts` is currently configured; check that file if
attachments matter to you, since its storage location isn't necessarily
covered by the `pg_dump` above.

---

## 10. Upgrade procedure

1. `git pull` on the server (or redeploy from a new build).
2. Check `db/` for any migration files newer than the last one you ran —
   run each new one, **in filename order**, the same way as §4.2.
3. Backend: `npm install && npm run build`, then restart the service
   (`sudo systemctl restart erp-backend`).
4. Frontend: `npm install && npm run build`, then restart
   (`sudo systemctl restart erp-frontend`) — required even for a
   backend-only change if `NEXT_PUBLIC_API_URL` didn't change, skippable
   only if the frontend's own code/build didn't change either.
5. Spot-check `GET /health` and log in once as a real user afterward.

If an org existed before a feature that added new Chart-of-Accounts
template entries (customs duty, GST split accounts, etc.), it won't have
picked those up automatically — a user with `coa.manage` can run **Chart
of Accounts → Sync from Templates** (`POST /accounts/sync-templates`) to
backfill any missing accounts into that one org. Safe to run repeatedly;
it only adds what's missing, never touches or duplicates what's there.

---

## 11. Security hardening checklist

- [ ] `JWT_SECRET` is long, random, and not the placeholder from
      `.env.example`.
- [ ] `EXPOSE_DEV_OTP` is off, **and** a real SMS/email provider has
      actually been wired in first (§5.2) — turning it off without that
      locks users out of OTP-based flows, it doesn't secure anything by
      itself.
- [ ] Postgres is not reachable from the public internet — bind it to
      localhost or a private network, firewall port 5432.
- [ ] The backend (port 4000) and frontend (port 3000) are only reachable
      through the reverse proxy, not directly — firewall those ports from
      external access.
- [ ] TLS is enforced (HTTP → HTTPS redirect) on both the app domain and
      the API subdomain.
- [ ] Database backups (§9) are automated, tested with an actual restore
      at least once, and stored somewhere other than the same server.
- [ ] The `erp_app` Postgres role's password and the server's `erp` OS
      user are not shared with any other system.
- [ ] OS-level patching (`apt update && apt upgrade`) is on a schedule.

---

## 12. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `npm install` or `prisma generate` fails with a network/403 error | No outbound internet access from this server — see the note in §2. |
| Backend starts but every request 500s with a Prisma error | `prisma generate` didn't run against the current `schema.prisma`, or `DATABASE_URL` is wrong/unreachable. Re-run `npx prisma generate` inside `backend/`. |
| Frontend shows "Could not reach the backend" | `NEXT_PUBLIC_API_URL` is unset, wrong, or the backend isn't actually reachable at that URL from wherever the request originates — remember this is baked in at build time, not read at runtime. |
| A brand-new org's Chart of Accounts looks empty or missing recent accounts (e.g. Customs Duty Payable) | Run `POST /accounts/sync-templates` for that org — see §10. |
| Users can't complete signup/password-reset — no OTP arrives | Expected until a real SMS/email provider is wired up — see §5.2. |
| A migration fails partway through | Check you ran every prior migration first, in order — several `ALTER TABLE` statements assume columns/tables an earlier migration created. |

---

## Open items not covered by this manual

- **No Dockerfile/docker-compose exists in this repo** — everything above
  assumes bare Node processes under systemd. Containerizing is on you if
  you want it.
- **No CI/CD pipeline for on-prem** — the Railway/Vercel deployments
  redeploy automatically on push to `main`; an on-prem install has no
  equivalent unless you build one (Jenkins, GitHub Actions runner, etc.).
- **No SMS/email provider wired up** — see §5.2, this blocks real OTP
  delivery regardless of hosting.
- **No load testing has been done** — the sizing numbers in §1 are
  starting points, not measured capacity.
