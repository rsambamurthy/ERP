# SmartERP Design System

SmartAppt Gold actually uses **two distinct visual systems** — verified from
its own source (`frontend/src/pages/LoginPage.tsx` and `frontend/src/index.css`
on the `feature/accounting-v2` branch), not guessed. Match each exactly for
its context; don't blend them.

## 1. Public auth pages (login/register) — cream/terracotta

Exact values from `LoginPage.tsx`'s `T` theme object:

- `cream-50` #FDF8F5 (input bg) · `cream-100` #F5F0E5 (page bg) · `cream-200` #E8D9C0 (borders) · `cream-300` #DDD0C8 (input borders)
- `terracotta-500` #C4572B (primary) · `terracotta-600` #9C3F1E (hover/dark) · `terracotta-700` #8A6050 (labels)
- Card: 360px wide, 20px radius, `0 8px 32px rgba(0,0,0,0.13)` shadow, cream border, tall logo header band, white body, cream "Powered by" footer strip.

Components: `components/ui/AuthCard.tsx`, `Input.tsx`, `Button.tsx`, `Logo.tsx`, `StepIndicator.tsx`. Used by `/register` and `/login`.

## 2. Authenticated app (dashboard, accounting, everything behind login) — navy/blue enterprise

This is SmartAppt's actual `sa-`/`ent-` system, ported wholesale from
`frontend/src/index.css` into `app/globals.css` (same class names, only
rebranded where it says "SmartAppt"). Do not reinterpret this in Tailwind —
use the classes directly.

- Page background `--color-bg` #f1f5f9, header `--theme-primary` #0c2d72 (navy), accent `--theme-accent` #1a6bcc (blue), accent-light #e0ecff.
- Shell: `sa-shell` > `sa-header` (sticky navy bar, `sa-logo`) + `sa-body` > `sa-sidebar` (`sa-mg`/`sa-mg-h`/`sa-mi` accordion groups) + `sa-main`.
- Page content: `ent-page-hdr` (title+subtitle), `ent-toolbar` (search/filter/add-button row), `ent-page-table` (list views), `ent-section`/`ent-form-grid`/`ent-fg`/`ent-fl`/`ent-fc` (forms), `ent-table` (dense inline tables, e.g. journal entry lines), `badge`/`badge-*` (status pills), `ent-tabs`/`ent-tab` (tab bars).

Component: `components/layout/AppShell.tsx` (mirrors SmartAppt's `Layout.tsx` WebLayout structure), menu data in `components/layout/navGroups.ts`.

## Rule going forward

New public/auth screens → system 1 (Tailwind cream/terracotta classes).
New authenticated app screens → system 2 (`sa-`/`ent-` CSS classes from
`globals.css`, plain className strings, not Tailwind utilities). If a new
`ent-*`/`sa-*` pattern is needed that SmartAppt has but isn't ported yet,
pull it from the same `index.css` rather than inventing a new Tailwind
equivalent.
