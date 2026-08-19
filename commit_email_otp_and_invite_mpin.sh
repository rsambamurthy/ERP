#!/usr/bin/env bash
# 1) Real email OTP delivery (registration + M-PIN) via SMTP, own-domain mailbox.
# 2) accept-invite: optional first-time M-PIN, set straight away, no OTP.
# Review the diff, then run this yourself: bash commit_email_otp_and_invite_mpin.sh
set -euo pipefail

cd "$(dirname "$0")"

git add \
  backend/package.json \
  backend/.env.example \
  backend/README.md \
  backend/src/lib/email.ts \
  backend/src/lib/otp.ts \
  backend/src/routes/auth.ts \
  frontend/lib/api.ts \
  "frontend/app/accept-invite/page.tsx"

git commit -m "Email OTP delivery via SMTP + first-time M-PIN on accept-invite

- lib/email.ts: sendEmail() over nodemailer, SMTP creds from env
  (SMTP_HOST/PORT/SECURE/USER/PASS/FROM), defaults tuned for GoDaddy
  Workspace Email. lib/otp.ts routes email destinations through it;
  phone stays a console-log stub. Console fallback (SMTP not yet
  configured) now logs the OTP itself, not just the subject line —
  recoverable server-side without ever exposing it over HTTP, useful
  once EXPOSE_DEV_OTP is turned off.
- POST /auth/accept-invite accepts an optional mpin — set immediately,
  no separate OTP round-trip, since the invite token itself is the
  proof of identity (invite-only today, no open self-registration).
  Never overwrites an existing mpinHash.
- Frontend: accept-invite page gets an optional M-PIN + confirm field;
  api.ts's acceptInvite() takes the new param.

Run npm install in backend/ (adds nodemailer). Set SMTP_USER/SMTP_PASS
to enable real email; leave unset and behavior is unchanged. Consider
setting EXPOSE_DEV_OTP=false now that email OTP has a real delivery
path and invited users don't need OTP at all for their first M-PIN."

echo "Committed. Push when ready: git push"
