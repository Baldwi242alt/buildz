# BuildZ hosted release status

Updated 2026-09-13. Free-only hosting was explicitly selected by the owner.

## Verified

- Supabase project `teiwomkhgorwxqjvmdgn` in Singapore, asymmetric ES256 Auth keys.
- Six application migrations applied using verified TLS with the provider CA.
- Separate `buildz_api` and `buildz_worker` restricted logins verified.
- Supabase Cron `buildz-reservation-expiry` completed successfully after the
  explicit worker-role membership fix. This replaces the paid Render worker.
- GitHub `Baldwi242alt/buildz`, branch `master`; API 0.3.0 deployed from `94e467f`.
- Render service **BuildZ-api**, ID `srv-daj46p67bikc73am6s90`, Free Docker.
- API https://buildz-api.onrender.com passed liveness, database readiness,
  metadata, anonymous public discovery, and unauthenticated private-read rejection.
- Frontend https://buildz.onrender.com deployed as free Render site BuildZ.
- API APP_ORIGIN and CORS_ORIGINS use the exact frontend origin; live CORS passed.
- SPA rewrite `/*` to `/index.html` saved and deep-link HTML checks passed.
- Reserved `demo@buildz.example` identity created through Supabase admin with no
  confirmation email sent. Live password sign-in and authenticated `/v1/me`
  verified: exactly one student membership in fictional BuildZ Demo Campus,
  project creation capability, and no administrator or other privileged roles.
  This is a shared demonstration login, not a real student's private account.
- Local backend 44 tests pass, including mentorship consent, calendar privacy,
  consultation gating, and complete demo seeding without overwriting edits.
- Frontend production build passes. Seven targeted calendar/mentorship browser
  tests and nine baseline browser tests pass, including private-project consent,
  accepted-mentor consultation booking/cancellation, and collaboration examples.
- Live authenticated demo tour verifies three public projects and a fourth
  private project, three teammates, two fictional mentors, four venues,
  free/busy calendars, saved bookings, accepted mentorship and consultation,
  progress, feedback, PDF, messages, credits and notification examples.
- Both existing Render services auto-deploy successful pushes to `master`;
  database migrations remain an explicit operator step before dependent code.

## Demo scope and safe updates

The hosted fixture seed is `npx tsx scripts/hosted-setup.ts demo-content` using
the ignored owner configuration and verified provider CA. It is additive and
preserves existing IDs/edits. Opening hours and availability cover 42 days from
the initial seed, with 14 days of mentor slots. They do not roll forward on each
visit. Demo appointments are fictional, not real venue or advisor commitments.
Mentor profiles are fixture records, not new Auth logins. New requests remain
pending until the assigned real mentor authenticates and accepts; the student
account cannot approve its own request or impersonate a mentor. No staff role
was granted to the shared student login.

Use `demo-tour-check` with an ephemeral `BUILDZ_DEMO_PASSWORD` environment value
for read-only hosted verification; the script never prints credentials/tokens.
Do not upload personal/private data into the shared demo account.

## Still required before calling the full application ready

- Set Supabase Auth site/redirect URLs and configure public email delivery;
  Supabase's default email sender is restricted and is not a public signup solution.
- Bootstrap the intended real school administrator; verify real student accounts.
- Run authenticated hosted workflows across two accounts/devices.
- Verify the Render proxy trust path before enabling per-client proxy trust.
  `TRUST_PROXY_HOPS=0` remains conservative during initial setup but can group
  clients behind the load balancer into the same rate-limit bucket.

No paid service was provisioned. Free API sleep, provider quotas, and Supabase
pausing/backups limitations still apply. Credentials remain only in ignored local
operator files and the appropriate provider environment, not this document.
