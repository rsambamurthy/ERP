#!/usr/bin/env bash
# Surface email/phone + password login as an alternative on the M-PIN/OTP
# login screen (no backend changes — POST /auth/login already existed).
# Review the diff, then run this yourself: bash commit_password_login_toggle.sh
set -euo pipefail

cd "$(dirname "$0")"

git add frontend/app/login/page.tsx

git commit -m "Login: surface email/phone + password as an alternative to M-PIN

- /login's identifier step gets a 'Sign in with password instead'
  toggle. Flipped on, it reveals a Password field and submits straight
  to the existing POST /auth/login (login() in lib/api.ts was already
  there, just unused by this screen).
- 'Forgot password?' link shown in password mode, pointing at the
  existing /forgot-password page.
- M-PIN/OTP remains the default flow; this is additive, not a
  replacement."

echo "Committed. Push when ready: git push"
