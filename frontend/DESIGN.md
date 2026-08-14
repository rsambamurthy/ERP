# SmartERP Design System

One visual system across the whole app — public auth pages (login/register/
forgot-password/accept-invite) and the authenticated app (dashboard,
accounting, everything behind login) share the same navy/blue enterprise
tokens. The cream/terracotta identity that public pages used to have has
been retired.

## Tokens (`app/globals.css` `:root`)

- Page background `--color-bg` #f1f5f9
- Header/heading `--theme-primary` #0c2d72 (navy)
- Accent `--theme-accent` #1a6bcc (blue), `--theme-accent-light` #e0ecff
- Surface `--color-surface` #ffffff, border `--color-border` #e2e8f0, muted text `--color-muted` #64748b, body text `--color-text` #0f172a

## Public auth pages (login/register/forgot-password/accept-invite)

Plain CSS classes in `globals.css` (`.auth-*`), not Tailwind utilities —
same convention as the `sa-`/`ent-` system below.

- `.auth-page` — full-height centered wrapper, `--color-bg` background.
- `.auth-card` (+ `.auth-card-hdr`/`.auth-card-body`/`.auth-card-ftr`) — the branded card: navy header band with logo/wordmark, white body, "Secure & Private" footer strip. Width is per-page via a prop (`AuthCard`'s `width`, default 420) — Login/Forgot Password/Accept-invite stay a single-column form width; Register uses 720 for its wide accordion.
- `.auth-h2`/`.auth-p`/`.auth-intro`/`.auth-muted` — heading/body text.
- `.auth-fg`/`.auth-fl`/`.auth-fc`/`.auth-pin` — form field wrapper/label/control/PIN input.
- `.auth-fieldset`/`.auth-legend` — grouped fields (Register's Trading/Manufacturing sections).
- `.auth-check`/`.auth-check.selected` — selectable option cards (Register's domain picker).
- `.auth-btn`/`.auth-btn-secondary`, `.auth-link` — buttons and inline links.
- `.auth-err`/`.auth-hint` — error and dev-mode OTP callouts.

Components: `components/ui/AuthCard.tsx`, `Input.tsx`, `Button.tsx`, `Logo.tsx`, `AccordionStep.tsx`.

`/register` is a single wide accordion inside one `AuthCard`: five `AccordionStep` panels (Sign up, Verify, Select business domain(s), Details, Workspace), each with an icon chip (`components/steps/stepIcons.tsx`), title, and a one-line status subtitle. Steps gate sequentially — only the current step is expanded/interactive (`.acc-step.active`), completed steps collapse with a checkmark (`.acc-step.complete`), future steps stay locked and dimmed (`.acc-step.locked`). `StepIndicator.tsx` is unused (superseded by the accordion's own step badges) but the file is still present in the repo.

The root URL (`/`) redirects straight to `/login` — there's no splash/landing page anymore.

## Authenticated app (dashboard, accounting, everything behind login)

This is SmartAppt's actual `sa-`/`ent-` system, ported wholesale from
`frontend/src/index.css` into `app/globals.css` (same class names, only
rebranded where it says "SmartAppt"). Do not reinterpret this in Tailwind —
use the classes directly.

- Shell: `sa-shell` > `sa-header` (sticky navy bar, `sa-logo`) + `sa-body` > `sa-sidebar` (`sa-mg`/`sa-mg-h`/`sa-mi` accordion groups) + `sa-main`.
- Page content: `ent-page-hdr` (title+subtitle), `ent-toolbar` (search/filter/add-button row), `ent-page-table` (list views), `ent-section`/`ent-form-grid`/`ent-fg`/`ent-fl`/`ent-fc` (forms), `ent-table` (dense inline tables, e.g. journal entry lines), `badge`/`badge-*` (status pills), `ent-tabs`/`ent-tab` (tab bars).

Component: `components/layout/AppShell.tsx` (mirrors SmartAppt's `Layout.tsx` WebLayout structure), menu data in `components/layout/navGroups.ts`.

## Rule going forward

Everything — public or authenticated — pulls from the same `--theme-primary`/`--theme-accent`/`--color-bg` tokens via plain CSS classes in `globals.css` (`.auth-*` for public pages, `sa-`/`ent-` for the authenticated app), not Tailwind utility color classes. `tailwind.config.ts` still defines the old `cream`/`terracotta`/`brand` ramps but nothing should reference them going forward — they're left in place only in case something outside this doc's scope still points at them.
