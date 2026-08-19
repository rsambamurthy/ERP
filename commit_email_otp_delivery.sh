#!/usr/bin/env bash
# Real email OTP delivery (registration + M-PIN) via SMTP through a mailbox
# on your own domain (e.g. GoDaddy Workspace Email).
# Review the diff, then run this yourself: bash commit_email_otp_delivery.sh
set -euo pipefail

cd "$(dirname "$0")"

git add \
  backend/package.json \
  backend/.env.example \
  backend/README.md \
  backend/src/lib/email.ts \
  backend/src/lib/otp.ts

git commit -m "Send real email OTPs via SMTP (own-domain mailbox)

- New lib/email.ts: sendEmail() over nodemailer, SMTP creds from env
  (SMTP_HOST/PORT/SECURE/USER/PASS/FROM), defaults tuned for GoDaddy
  Workspace Email (smtpout.secureserver.net:465).
- lib/otp.ts: email destinations now send for real; phone stays a
  console-log stub (no SMS gateway yet). devOtp fallback unaffected.
- .env.example + README document the new vars and the Railway deploy
  step; Known gaps note updated.

Run npm install in backend/ (adds nodemailer), then set SMTP_USER/
SMTP_PASS to a mailbox on your domain (e.g. otp@yourdomain.com) locally
and in Railway. Without those set, behavior is unchanged from before."

echo "Committed. Push when ready: git push"
