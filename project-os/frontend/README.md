# Project OS Frontend

Next.js 14 (App Router) + React 18 + TypeScript, deliberately mirroring
SmartERP frontend's own conventions (see `../../frontend/README.md`) —
same client-side-only auth guard shape (`AppShell`, no `middleware.ts`),
same hand-rolled `lib/api.ts` fetch wrapper + `lib/auth.ts` session
helpers, same "one route folder = one page" App Router layout — but a
fully separate app: separate `package.json`, separate deploy target, no
imports across the boundary. Talks to `project-os/backend`, **not**
SmartERP's backend.

## Scope (R1 — Pilot, first frontend pass)

Per the PRD (`../../prd-r1-pilot.docx`) this pass deliberately covers the
shell plus the two most foundational features, not the whole backend
surface:

- **Auth** — `/login`, `/register`. Session stored in `localStorage`
  (`lib/auth.ts`) — same MVP simplification SmartERP frontend uses, flagged
  the same way in its own comment. Project OS's JWT carries
  `organizationId` itself and every backend route scopes off it
  server-side, so — unlike SmartERP's platform-admin case — this frontend
  never needs to track an org id separately.
- **App shell + nav** (`components/layout/AppShell.tsx`, `navGroups.ts`) —
  role-aware sidebar (Dashboard, Projects), header with the logged-in
  user's name/role and a log-out button. Redirects to `/login` if not
  authenticated, client-side, in a `useEffect` — no `middleware.ts`, same
  as SmartERP frontend.
- **Dashboard** (`/dashboard`) — project counts + a recent-projects list.
- **Projects** (`/projects`, `/projects/[id]`) — list + create; detail
  page shows project info and Sites (create a site — becomes a
  `PROJECT_SITE` stock-location target once Inventory is wired into the
  UI), with links out to BOQ and Budget.
- **BOQ & Estimation** (`/projects/[id]/boq`) — version tabs, "start new
  version," Excel import (download template / pick file / preview table
  with per-row create-vs-error status / apply), manual single-line add,
  a lines table with an inline expandable per-line Estimate editor
  (material/labour/subcontract/overhead → total), and Approve.
- **Budget** (`/projects/[id]/budget`) — version tabs, "Generate from
  Approved BOQ" (surfaces the backend's "N lines have no estimate"
  warning if it comes back), per-category baseline vs. approved amounts,
  Approve.
- **SmartERP Integration settings** (`/settings/integration`, Super
  Admin only) — added in a follow-up pass after the initial scaffold, to
  make the demo self-serve instead of needing curl: enter the SmartERP
  API base URL + API key (generated on the SmartERP side under its own
  Integration Connections screen), save the connection, then "Sync now"
  to pull Business Partners/Items/Branches. This is what actually
  populates the Customer dropdown on New Project and the Item dropdown
  on BOQ Add Line with real data — both are empty until a sync has run.

Dropdowns that now have real, bounded values instead of free text: BOQ
line UOM (`lib/uom.ts` — a fixed common-units list; the backend still
accepts any string, so this is a frontend-only convenience, not
validation), and Project Site state code (`lib/gstStates.ts` — the same
GST state code list SmartERP frontend uses, copied rather than imported
per the no-cross-app-imports rule above). Cost Category was already a
real dropdown (five categories auto-seeded at org registration); Item
and Customer are real dropdowns but depend on a SmartERP sync having run
first (see above) — an org that hasn't connected yet will see them
empty, by design, not a bug.

Also fixed in this pass: the BOQ import template download was a plain
`<a href>` pointing at a route behind `authenticate()` — link
navigations don't carry the `Authorization` header, so it silently
401'd. Now uses the same fetch-blob-and-click-a-throwaway-`<a download>`
pattern SmartERP frontend's own `downloadFile()` uses.

**Not built yet, in this pass**: Procurement UI (Material Request → RFQ
→ Quotation → PO), Inventory/GRN UI, Site Execution UI (Activities,
progress). The backend for all of these already exists — see
`../backend/README.md` — this is purely "no page built yet," same
"route surface exists, UI doesn't" gap the backend itself flags for its
own still-unbuilt pieces. Natural next frontend passes, in roughly the
order the backend was built: Procurement, then Inventory/GRN.

Also not built: project lifecycle status editing (PATCH `/projects/:id`
exists on the backend, no UI control for it here yet — status shows
read-only on the detail page), team member management, Contract data.

## Styling

An original, small Tailwind component-class system (`app/globals.css`,
the `.pos-*` classes) covering the same structural roles SmartERP
frontend's own `.ent-*`/`.sa-*` system does — page header, toolbar,
section card, table, form grid, buttons, badges — but not a byte-for-byte
copy of that system (it's large and specific to SmartERP's own page
inventory). Close enough in feel to be visually at-home next to
SmartERP's UI, not pixel-identical to it.

## Local setup

```
npm install
copy .env.example .env.local   # Windows; `cp` on macOS/Linux
# edit .env.local if project-os/backend isn't on the default localhost:4100
npm run dev
```

Runs on **port 3100** (not Next's default 3000) — deliberately, so it can
run side by side with SmartERP frontend's own `npm run dev` (port 3000)
without a conflict, same "separate port" convention project-os/backend
uses (4100 vs SmartERP backend's 4000).

## Deploy

Same model as SmartERP frontend: Vercel, "Add New → Project," import the
`rsambamurthy/ERP` repo, set **Root Directory to `project-os/frontend`**,
set `NEXT_PUBLIC_API_URL` in Vercel's env vars to wherever
`project-os/backend` ends up deployed (task #120 — not deployed yet as of
this pass; point it at `http://localhost:4100` for local testing only
until then).

## Verified

Same caveat applies to the follow-up pass above (Integration settings
page, Customer/UOM/State dropdowns, template-download fix) as to the
original scaffold below: reviewed by hand (import paths, exported
function names/shapes cross-checked against usage), not compiled in
this sandbox. Re-run `npm run dev` and click through it after pulling
these changes.

The build sandbox this was written in can't reach the npm registry, so
`npm install` / `npx tsc --noEmit` could not actually be run here —
verification was manual code review instead: every relative import path
in `app/**` checked against actual folder depth, and every function
imported from `lib/api.ts` / `lib/types.ts` in each page cross-checked
against what those files actually export (names, param shapes, response
envelopes). No mismatches found. This is **not a substitute for a real
compile** — run `npm install && npx tsc --noEmit` on your machine before
trusting this scaffold, and it's **not yet exercised against a live
`project-os/backend` server or in a browser** — that's the next step,
live-testing login → create project → create BOQ version → import/add
lines → set an estimate → approve → generate budget → approve budget,
the same collaborative walkthrough rhythm used for every backend feature
this session.
