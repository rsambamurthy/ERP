# SmartERP Design System

Visual language is modeled on SmartAppt Gold (smartapptgold.integratatech.ai). Apply
this to every new screen, not just the registration wizard.

## Palette (tailwind.config.ts)
- **cream** (50/100/200) — page background, card headers, subtle borders
- **navy** (600–900) — headings, primary text, wordmark ("Smart")
- **terracotta** (50/100/400–700) — brand accent: buttons, active states, links, wordmark ("ERP")
- Body background: `#f3ece0` (globals.css)

## Components (components/ui/)
- `Logo.tsx` — navy rounded-square icon with terracotta swoosh
- `AuthCard.tsx` — cream gradient header band (logo + wordmark) over a white body; use for any card-style entry point
- `Button.tsx` — primary = terracotta fill; secondary = white with cream border
- `Input.tsx` — uppercase terracotta label, cream-tinted field, terracotta focus ring
- `StepIndicator.tsx` — terracotta done/active states, navy active label

## Conventions
- Headings: `font-bold text-navy-800` (or `font-semibold` for card titles)
- Cards: `rounded-2xl border border-cream-200 bg-white shadow-sm`
- Buttons/pills: `rounded-xl`, terracotta primary action
- Wordmark always renders as `Smart` (navy-800) + `ERP` (terracotta-500)

Reuse these classes/components rather than the old `gray-*`/`brand-*` styling
left over from initial scaffolding — dashboard, steps/*, and any new modules
should be brought into this system as they're touched.
