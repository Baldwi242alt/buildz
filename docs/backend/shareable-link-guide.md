# Publish BuildZ and get the shareable link

The frontend link is the one to send judges. GitHub stores code; it does not run this PostgreSQL/Nest backend. A localhost link only works on the current computer. No public deployment is implied by these files.

## What the owner needs to do first

1. Create a Supabase project and keep its database password private. Use Singapore when available/appropriate. Do not paste credentials into chat or commit them.
2. Create a Render account and authorize GitHub access to `Baldwi242alt/buildz`.
3. Confirm that the intended repository actually contains the current local code. This workspace did not have a Git remote or commit when inspected; review and push through your normal GitHub workflow before connecting Render. Do not replace another repository's work.
4. The owner selected free-only hosting. Root `render.yaml` now uses a free API and static frontend, with Supabase Cron replacing the paid worker. Do not deploy the paid alternative `infra/render-backend.yaml` without new approval. Do not add a payment method or enable usage overages for this release.

## Prepare Supabase

Use confirmed-email Auth and asymmetric ES256/RS256 signing keys. Keep the application `app` schema outside the Data API's exposed schemas. Obtain the project URL and **publishable** key for the frontend. A secret/service-role key is not needed by the browser or this API.

### Public signup and password recovery

Configure custom SMTP in Supabase before inviting arbitrary visitors to create email/password accounts. Supabase's default email service restricts recipients to project organization members and is not a public signup solution. Use a verified sender with an email provider; enter SMTP credentials only in Supabase's secure settings. Keep email confirmation enabled: the API deliberately rejects unconfirmed accounts. Test confirmation and password recovery with an address outside the project organization. See [Supabase SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).

The frontend owner confirmed that signup confirmation and recovery return to the frontend root `/`, where the app handles the session. Configure the exact production root URL in Auth's allowed redirects and Site URL. Real signup UI is implemented; actual hosted email delivery still needs verification. A newly confirmed user receives an application profile, not an automatic school affiliation or staff role. They must request school verification; the intended school administrator approves it.

### Availability and cost

A hosted deployment runs independently of the laptop, but free hosting is a hackathon deployment, not an always-on production guarantee. Render Free sleeps after 15 idle minutes and takes about a minute to wake; monthly quotas can suspend service or prevent builds. Supabase Free can pause after inactivity, has a 500 MB database allowance and no automatic backups. Private uploaded files currently consume that database allowance. Do not use synthetic keep-alive traffic to defeat free-tier limits. See [Supabase plans](https://supabase.com/pricing) and [Render free limitations](https://render.com/docs/free).

Run `infra/supabase-cron.sql` through the operator helper's `cron` mode after migrations, then check `cron-status` after a minute. It installs a named once-per-minute job, drops to `buildz_worker` for the expiry commands, and needs no external worker credentials. Expiry can lag by a minute (longer during a paused database/outage); it continues while the API sleeps as long as Supabase runs. This is business maintenance, not an API keep-alive. Monitor the job history and review log retention as the database grows. Never remove the scheduler without a working replacement. See [Supabase Cron](https://supabase.com/docs/guides/cron).

Follow `deployment.md` to apply migrations with the owner connection, create strong separate login passwords for `buildz_api` and `buildz_worker`, and bootstrap a real school administrator. Migration/owner credentials belong only in the operator's environment, not deployed API variables.

When using Supabase's shared pooler, a custom role username has the form `buildz_api.<project-ref>` (or `buildz_worker.<project-ref>`), with that role's own password. Copy the actual pooler host/port from the project's connection settings. Use the direct/session connection for migrations; runtime URLs must resolve to the intended custom database role. Passwords containing URL-special characters must be percent-encoded. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [custom database roles](https://supabase.com/docs/guides/database/postgres/roles).

## Create the services

Once the code is on GitHub, Render's New Blueprint flow can use root `render.yaml`. It describes two services:

| Service | Purpose |
|---|---|
| buildz-web | Static React/Vite frontend; this gets the shareable address |
| buildz-api | HTTPS API with private application/database access |
| Supabase Cron (separate database setup) | Background reservation/invitation expiry; not a Render service |

The static site builds from the repository root, so the shared SDK workspace is available. The wildcard rewrite makes direct `/showcase/<id>` and `/invitations/<id>` refreshes work. The Blueprint leaves deployment manual initially and asks for environment variables rather than embedding credentials. Render's generated names/addresses are not guaranteed to exactly match these service labels. Copy the actual URLs shown in your dashboard. See the [Render Blueprint reference](https://render.com/docs/blueprint-spec).

## Enter the connection values

For **buildz-web**, set these public, build-time values and rebuild after changing them:

| Variable | Value |
|---|---|
| VITE_BUILDZ_API_BASE_URL | Actual API HTTPS origin followed by `/v1` |
| VITE_BUILDZ_AUTH_URL | Your Supabase project URL, without `/auth/v1` |
| VITE_BUILDZ_AUTH_PUBLISHABLE_KEY | Supabase publishable key only |
| VITE_BUILDZ_LOCAL_DEMO | `false` |

The existing frontend adapter removes `/v1` before constructing the SDK. Code using the SDK directly should use only the origin.

For **buildz-api**, set:

| Variable | Value |
|---|---|
| DATABASE_URL | Secret TLS connection string for the `buildz_api` database role |
| DATABASE_SSL | `true` |
| TRUST_PROXY_HOPS | Verified number of reverse-proxy hops on the deployed API path; do not guess or set `true` |
| AUTH_ISSUER | `<Supabase-project-URL>/auth/v1` |
| AUTH_JWKS_URL | `<Supabase-project-URL>/auth/v1/.well-known/jwks.json` |
| AUTH_USERINFO_URL | `<Supabase-project-URL>/auth/v1/user` |
| AUTH_AUDIENCE | `authenticated` |
| AUTH_PUBLISHABLE_KEY | Supabase publishable key |
| APP_ORIGIN | Actual HTTPS frontend origin, no trailing slash |
| CORS_ORIGINS | That exact frontend origin, no trailing slash |
| NODE_ENV | `production` |

For the free deployment, do not create a Render worker or upload `WORKER_DATABASE_URL`. Supabase Cron invokes the restricted expiry functions inside the database. If a paid worker is approved later, use its separate role/password with `DATABASE_SSL=true`, `NODE_ENV=production`. Never deploy the owner URL. The container includes the public Supabase CA certificate and retains hostname/chain verification.

The API defaults to trusting zero proxies for safe direct/local operation. Behind Render this can group visitors under the load balancer's address. Before release, verify the provider's current proxy topology and set `TRUST_PROXY_HOPS` appropriately; test distinct client networks and a forged `X-Forwarded-For` value. All public paths must have the verified hop count, otherwise use an explicitly reviewed subnet-based trust policy instead. Never blindly trust the leftmost forwarded address. See [Express proxy security](https://expressjs.com/en/guide/behind-proxies/) and [Render edge networking](https://render.com/articles/how-render-handles-ddos-attacks). The current limiter is single-instance; multiple API instances require a shared limiter store.

In Supabase Auth's URL Configuration, set Site URL to the actual frontend URL and allow the frontend's implemented login/recovery callback paths. Do not retain localhost as the production redirect. Ask the frontend owner for exact callback routes instead of guessing them. See [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Test before sharing

Run a read-only smoke check after deployment:

```sh
npm run smoke:backend -- --api https://YOUR-ACTUAL-API-HOST --app https://YOUR-ACTUAL-FRONTEND-HOST
```

This checks backend health/contract, anonymous public discovery, rejection of unauthenticated private reads, the frontend HTML and its deep-link fallback. It does not substitute for logged-in browser tests.

Then test from a second browser/device:

1. Sign up/confirm two real accounts; bootstrap the intended staff role and verify a student affiliation.
2. Create a project; verify that an unrelated account cannot read the private workspace.
3. Share an invitation and accept with the intended email; refresh to confirm persistence.
4. Publish only a safe summary and open its showcase link while signed out.
5. Try a proposal/review, upload/download, resource quote/booking and cancellation.
6. Check consultation, message, notification and voucher flows with their correct scoped roles.
7. Confirm local demo login/preview controls are absent in the production build.
8. Confirm signup email and password recovery arrive at an address outside the Supabase organization. Test recovery in a new browser session and reject reused/expired links.
9. Confirm the Supabase Cron job has successful runs in the same hosted database as the API and that due pending reservations expire and release held voucher credit.
10. Turn off the laptop's local API/frontend processes and repeat the hosted login, showcase and booking checks from a phone using mobile data. This verifies that no localhost dependency is hidden in the production configuration.

Treat API readiness, authenticated workflow checks, worker health and email delivery as separate release gates. The read-only smoke command cannot prove all four. Record the deployed Git commit and each gate's result before calling the release complete. Implemented features exclude real payment collection and external email/push application notifications; Auth confirmation/recovery email is a separate required integration.

The local fictional issuer is deliberately not deployed. Local fixture UUIDs are not real Supabase identities. Use actual Auth accounts for the public demo; never turn the local impersonation endpoint into a public login shortcut.

After these checks, share **the actual buildz-web HTTPS URL**. There is no need to leave the laptop running for a hosted deployment. Until the accounts, GitHub push, configuration and host checks are complete, the honest status is “deployment prepared, not publicly live.”
