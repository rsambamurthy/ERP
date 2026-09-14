#!/bin/bash
# Run this yourself from the repo root — nothing has been committed or
# pushed automatically.
#
# This captures the registration email-verification rework:
#   - db/migration_056_pending_registration.sql (new pending_registrations table)
#   - backend/prisma/schema.prisma (PendingRegistration model + reverse relation)
#   - backend/src/lib/provisioning.ts (applyDomainSelection() helper)
#   - backend/src/lib/email.ts (SMTP-unconfigured fallback now logs the full body)
#   - backend/src/routes/auth.ts (POST /auth/register now stages a
#     PendingRegistration instead of creating org+user; POST /auth/verify-otp
#     removed; new POST /auth/verify-email)
#   - backend/src/routes/onboarding.ts (POST /onboarding/domain now stages
#     onto PendingRegistration and sends the verification email)
#   - backend/.env.example (FRONTEND_URL)
#   - backend/README.md (endpoint docs + Known gaps + deploy step 4b)
#   - frontend/lib/types.ts, frontend/lib/api.ts (RegisterPayload/-Response,
#     verifyEmail(), submitDomains() now keys off pendingRegistrationId)
#   - frontend/components/steps/SignUpStep.tsx (confirm-password field)
#   - frontend/components/steps/ProvisioningStep.tsx (repurposed into the
#     "check your email" final wizard step)
#   - frontend/app/register/page.tsx (4-step wizard — OTP step removed)
#   - frontend/app/verify-email/page.tsx (new — click-through landing page)
#
# `git add -A` also picks up any other uncommitted work already sitting in
# the tree from earlier in this session (Vendor Management Phase 1, email
# OTP delivery, invite-based M-PIN, email/password login toggle) if you
# haven't run those commit scripts yet — check `git status` first if you'd
# rather commit those separately.

set -e
cd "$(dirname "$0")"

git add -A
git commit -m "Registration: replace OTP with email-verification-link flow

- New pending_registrations table stages a signup (business info, password
  hash, domain selection) behind a random 64-char token instead of creating
  an organization/user immediately.
- POST /auth/register now requires both email and phone (phone is mandatory
  contact info, never itself verified) and returns pendingRegistrationId
  instead of organizationId/devOtp.
- POST /onboarding/domain stages the domain selection onto that pending row
  and emails a click-to-verify link (24h expiry) via the existing SMTP path.
- New POST /auth/verify-email consumes the token, creates the real
  organization/user/org_users/onboarding_state rows, applies the domain
  selection, runs provisioning, and logs the owner in — idempotent against
  a repeat click on an already-consumed link.
- POST /auth/verify-otp removed (dead code now that registration doesn't
  use OTP); M-PIN and forgot-password OTP flows are unaffected.
- Frontend: register wizard drops the OTP step, gains a 'check your email'
  final step; new /verify-email page is the link's landing target."

echo "Committed. Review with 'git show' or 'git log -1 -p', then push when ready."
