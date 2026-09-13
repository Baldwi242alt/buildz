# BuildZ backend hosting

These instructions prepare a shareable hosted application; they do not imply that a cloud service already exists. Frontend hosting is owned separately. The API and invitation URLs must use the actual configured HTTPS origins.

## 1. Create and configure Supabase

Create a project in the appropriate region (Singapore if that is the agreed pilot region). Enable confirmed-email authentication. Use an asymmetric JWT signing key (ES256 or RS256); legacy HS256-only projects must rotate to a supported signing key before using this backend.

Configure the frontend's site URL and allowed login redirects in Supabase Auth. Keep the `app` database schema outside the Data API's exposed schemas. Auth operates independently of that application schema.

Set a local, untracked migration environment with `MIGRATION_DATABASE_URL` pointing to the database owner and `DATABASE_SSL=true`. Use the provider's verified TLS connection settings. If a CA bundle is required, supply it through the Node trust store; do not disable certificate verification.

```sh
npm ci
npm run db:migrate
```

This applies the ordered files in `supabase/migrations` once. Use a direct/session-compatible owner connection for migrations. Runtime uses its own database login and a suitable provider connection/pooler URL.

## 2. Provision restricted database logins

Migrations create `buildz_api` and `buildz_worker` as non-login roles. For each role separately, set `RUNTIME_ROLE_PASSWORD` in the operator's environment to a fresh secret of at least 24 characters, then run:

```sh
npm run db:bootstrap -- --api-password
npm run db:bootstrap -- --worker-password
```

Use a distinct password for each invocation. Remove `RUNTIME_ROLE_PASSWORD` from the operator environment afterward. These commands do not print credentials. Set the API's `DATABASE_URL` with the `buildz_api` login and the worker's `WORKER_DATABASE_URL` with the `buildz_worker` login. Do not deploy the migration URL into the API/worker service environment.

## 3. Onboard an initial real school administrator

Create/confirm the intended user through Supabase Auth first and obtain that user's actual UUID. Operator bootstrap accepts explicit identity and school values:

```sh
npm run db:bootstrap -- --user-id <actual-auth-uuid> --email <confirmed-email> --name <display-name> --institution-id <school-uuid> --institution-name <school-name> --institution-slug <school-slug> --role institution_admin
```

Run another explicit bootstrap with `--role student` if an initial verified student is needed. Subsequent students can submit verification requests and the school's administrator can decide them. Bootstrap is a privileged operator command, never a public HTTP endpoint. Demo fixture UUIDs are not substitutes for real Auth UUIDs.

## 4. Build and deploy

The `infra/render-backend.yaml` template defines an API and worker in Singapore. It uses manual deployment initially and does not run owner migrations inside the application containers. Configure all fields marked `sync: false` in the host. Review the selected plans before provisioning paid services.

Both services use `infra/Dockerfile.api`; the worker overrides its command. The multi-stage image runs as an unprivileged OS user and includes only compiled backend code, runtime dependencies and the contract. The local demo issuer/scripts/database are not included.

Docker builds require the repository root as context:

```sh
docker build -f infra/Dockerfile.api -t buildz-backend .
```

Alternatively, use a Node host with `npm ci && npm run build:backend`, then `npm run start:api` or `npm run start:worker` with the appropriate environment. Start from the repository root so the API can load the canonical contract.

| API setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | TLS database URL using `buildz_api` |
| `DATABASE_SSL` | `true` |
| `AUTH_ISSUER` | `https://<project>.supabase.co/auth/v1` |
| `AUTH_JWKS_URL` | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` |
| `AUTH_USERINFO_URL` | `https://<project>.supabase.co/auth/v1/user` |
| `AUTH_AUDIENCE` | `authenticated` |
| `AUTH_PUBLISHABLE_KEY` | Supabase publishable project key; not a service-role key |
| `APP_ORIGIN` | Actual HTTPS frontend origin |
| `CORS_ORIGINS` | Comma-separated exact HTTPS frontend origins, no trailing slash |
| `PORT` | Supplied by host, or 3001 |
| `TRUST_PROXY_HOPS` | Verified hosted proxy-hop count; default 0 for direct/local requests |

The worker needs `NODE_ENV`, `DATABASE_SSL` and `WORKER_DATABASE_URL` only.

## 5. Connect and verify the shareable frontend

Supply the frontend with the API origin and Supabase URL/publishable key. Do not include `/v1` in the SDK base URL. The frontend imports `createBuildZClient` from `@buildz/sdk` and supplies a current access token.

Verify from another browser/device: HTTPS app URL loads; login returns to the requested path; two accounts see only their permitted projects; a shared invitation URL requires the intended email; accepted membership survives refresh; unimplemented feature flags remain false. The API's `/v1/health/ready` must pass before pointing a frontend at it.

The frontend host must serve direct `/invitations/<id>` and `/showcase/<id>` links correctly on refresh. Public data comes only from `/v1/public/projects`; never expose private `/v1/projects` data as a workaround. Root `render.yaml` is a complete frontend/API/worker alternative to the backend-only template. See `shareable-link-guide.md` for the owner-facing setup sequence.

## 6. Release and rollback

The backend CI workflow validates the contract, SDK freshness, types, compilation, actual PostgreSQL integration tests and dependency audit. Apply migrations before deploying an API version that needs them. These initial migrations are additive. Roll back an API artifact only if it remains compatible with the applied schema; never automatically run destructive down-migrations.

Monitor auth provider failures, HTTP 5xx, readiness, pool exhaustion, worker expiry errors and rate-limiter saturation. Preserve persistent database/object backups as later modules are added. Docker/cloud deployment needs validation in the actual host environment; local tests alone do not establish that a hosted app is live.

Reference for template fields: [Render Blueprint specification](https://render.com/docs/blueprint-spec).
