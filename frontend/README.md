# ERP frontend

Next.js 14 (App Router) + TypeScript + Tailwind. Implements the
registration/onboarding wizard from the design spec: sign up → verify →
select domain(s) → domain details → auto-provision → dashboard.

## Local development

```bash
npm install
cp .env.example .env.local   # then set NEXT_PUBLIC_API_URL
npm run dev
```

Runs at http://localhost:3000. `/register` is the wizard, `/dashboard` is
the post-provisioning landing screen.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the backend implementing the endpoints in section 7 of `docs/Registration_Module_Spec_v2.docx` (`/auth/register`, `/auth/verify-otp`, `/domain-types`, `/onboarding/domain`, `/onboarding/provision`, `/onboarding/status`). Point this at the Railway-hosted backend. |

Without a live backend, the wizard's requests will fail with a clear
"could not reach the backend" error rather than hanging — that's expected
until the backend exists.

## Deploying to Vercel

1. On [vercel.com](https://vercel.com), **Add New → Project**, and import
   the `ERP` GitHub repo.
2. Since the frontend lives in a subfolder, set **Root Directory** to
   `frontend` in the import screen (Vercel auto-detects Next.js once you do).
3. Under **Environment Variables**, add `NEXT_PUBLIC_API_URL` pointing at
   your Railway backend's public URL.
4. Deploy. Every push to `main` (or PRs, if you enable preview deployments)
   will redeploy automatically — same GitHub-triggered model as the Railway
   backend.

## Structure

```
app/
  page.tsx              landing page → links to /register
  register/page.tsx      wizard orchestration (state machine over the 5 steps)
  dashboard/              post-provisioning screen, scoped to active domains
components/
  steps/                  one component per wizard step
  ui/                     Button, Input, Card, StepIndicator
lib/
  api.ts                  fetch wrapper for the backend endpoints
  types.ts                shared TypeScript types
```

## Known gap

This was scaffolded without the ability to run `npm install`/`npm run
build` in the environment it was written in (no registry access there) —
it's been reviewed carefully by hand, but treat your first local
`npm install && npm run build`, or Vercel's own build log, as the real
verification step.
