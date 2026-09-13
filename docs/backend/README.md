# BuildZ backend — hackathon implementation

Implemented: M0–M6 backend workflows, with M7 integration/release tooling. The product name is **BuildZ**; package names and database identifiers use lowercase `buildz`. See `workflow-handoff.md` for the new module contracts and explicit hackathon limits; see `shareable-link-guide.md` for public deployment.

This backend runs separately from the frontend. Existing frontend commands and files are preserved. Proposals, progress evidence/files, resource scheduling, safe bookings, consultations, messages, notifications, public projects, collaboration and voucher credits are implemented. Notifications/messages use authenticated polling, not SSE. No real payment is charged. Hosted deployment still requires the owner's accounts and configuration; local completion is not proof of a live public release.

## Run locally

Use Node.js 24 (verified with 24.17.0) and npm. From the repository root:

```sh
npm ci
npm run dev:backend
```

The command starts a **real PostgreSQL 18 server**, applies the ordered migrations, seeds two fictional schools, starts a loopback-only JWT identity provider, and runs the API on `http://127.0.0.1:3001`. No Docker or Supabase account is needed for this local mode. The native PostgreSQL binary is installed as a development dependency. Local data persists under ignored `work/local-postgres`; do not run two copies against the same directory.

The console prints the local token endpoint and six fictional identities. Request a token from the printed address:

```http
POST http://127.0.0.1:<printed-auth-port>/token
Content-Type: application/json

{"userIndex":0}
```

Use the returned `access_token` as `Authorization: Bearer ...` when calling the API. Index 0 is Alice, 1 is Bob at the other school, 2 is Charlie, 3 and 4 are the two schools' administrators, and 5 is a student without a verified school affiliation. These are deliberately fictional accounts, not a signup bypass in hosted code. The local issuer is not included in the production build.

The API verifies the JWT signature, issuer, audience, expiry, subject and authenticated role. It also checks the identity provider's user endpoint for an active account and confirmed email. School roles come only from application records, never editable Auth metadata.

Stop with Ctrl+C to close HTTP servers and PostgreSQL cleanly. The test command creates its own isolated database and does not clear your development data.

If the backend is already healthy on the selected port, running the command again prints its URL and exits successfully. It leaves the existing process and database untouched. To load code changes, stop the original dev process before starting a new one. If only the database is running without a healthy API, startup still refuses to take over that database automatically.

## What works now

| Area | Implemented behaviour |
|---|---|
| Identity | Verified sign-in integration, own profile, display name/timezone edits and actual capabilities. |
| Institutions | Two demo schools, school directory, verified affiliations, student verification requests and scoped staff decisions. |
| Projects | Create, list, read, edit and lifecycle transitions; private by default; optimistic versions. |
| Teams | Email-addressed invitations, intended-recipient acceptance, decline/revoke/expiry, cross-school membership. |
| Ownership | One accepted owner, explicit owner transfer, member removal/exit and last-owner protection. |
| Links | Invitation URL built from configured `APP_ORIGIN`; the URL alone grants no access. |
| Reliability | Idempotent sensitive commands, transactional audit/outbox records, restricted invitation-expiry worker. |
| Integration | Canonical OpenAPI, runtime input/output validation, generated typed Fetch client and explicit unsupported capabilities. |
| Proposals and progress | School-scoped decisions, supervisor/time grants, progress summaries, private evidence and staff feedback. |
| Resources and time | Cross-school policies, staff-managed windows, personal availability, selected-team slot matching and nearest/price filters. |
| Bookings | Authoritative quotes, safety checks for every attendee, atomic resource/person conflicts, approval, cancellation and expiry. |
| Communication | Consultation scheduling, authorized project/supervisor messages and private in-app notification inboxes. |
| Public collaboration | Explicit public projections, share links, advice/join requests, owner consent and school moderation. |
| Credits | Fixed-amount institution vouchers, aggregate budgets, immutable price snapshots and cancellation releases. |
| Files | Private PNG/JPEG/WebP/PDF uploads, authenticated retrieval, 2 MiB/file and 50 MiB/project limits. |

An accepted invitation is not a way to rejoin after removal. Team access is checked on each read/write. School administrators do not gain automatic access to unsubmitted private student projects. Lead-school reviewers gain the project context only after a proposal exists; assigned supervisors can review progress and message without joining the team. Verified student affiliation is required to create a school-backed project; invited, email-verified collaborators can come from another school.

### Invitations and email

Creating an invitation returns a URL for the owner to share. **No email is sent by these phases.** A recipient can also find their pending invitations with `GET /v1/me/invitations` after signing in. The API binds acceptance to the verified email address, not possession of the link. Email changes require a new matching invitation.

This implements recipient-bound links rather than bearer invitation secrets, so no raw invitation token needs to be stored in an idempotency response. Public project URLs use `/showcase/:id` and return a separately authored public projection, never the private workspace.

## Backend commands

| Command | Purpose |
|---|---|
| `npm run dev:backend` | Persistent local database, fictional identity provider, API and expiry tick. |
| `npm run verify:backend` | Contract checks, SDK freshness, TypeScript, production build and integration tests. |
| `npm run test:backend` | Backend tests on an isolated real PostgreSQL database. |
| `npm run contracts:validate` | Validate all 79 current OpenAPI operations and compile their validators. |
| `npm run sdk:generate` | Regenerate the checked-in client types after an intentional contract change. |
| `npm run build:backend` | Compile API, worker and database support. |
| `npm run start:api` | Run the compiled API with configured Auth/database settings. |
| `npm run start:worker` | Run the restricted invitation-expiry worker. |
| `npm run db:migrate` | Apply ordered SQL migrations using migration-owner credentials. |
| `npm run db:bootstrap -- ...` | Explicit operator provisioning of database logins or initial school identities. |

The original `dev`, `build`, `test` and `typecheck` commands continue to belong to the frontend. Use the `:backend` commands for this implementation.

## API integration

The canonical interface is `packages/contracts/openapi.yaml`, with generated types under `packages/sdk`. All routes are prefixed with `/v1`. **The SDK's base URL is the origin only, without `/v1`**, because generated route keys already include that prefix.

```ts
import { createBuildZClient } from '@buildz/sdk';

const api = createBuildZClient({
  baseUrl: 'http://127.0.0.1:3001',
  getAccessToken: async () => currentAccessToken,
});

const me = await api.GET('/v1/me');
const created = await api.POST('/v1/projects', {
  params: { header: { 'Idempotency-Key': crypto.randomUUID() } },
  body: {
    title: 'Accessible Campus Guide',
    summary: 'A student-built guide to accessible campus routes.',
    projectType: 'community',
    leadInstitutionId: '11111111-1111-4111-8111-111111111111',
  },
});
```

`currentAccessToken` above is supplied by the frontend's session adapter. With Supabase, obtain it from the current Auth session. The SDK reads a fresh token for each call and does not store tokens or silently refresh sessions.

Responses use `{ data, meta: { requestId } }`. Paginated projects/invitations include `meta.nextCursor`; pass it back as `cursor`. Errors use `{ error: { code, message, retryable, requestId } }`. Inspect `error.code`; do not parse English messages.

Sensitive POST/DELETE commands require an `Idempotency-Key` of 8–128 letters/digits/underscores/hyphens. Reuse it only when retrying the same operation and JSON body. Successful results are retained per actor/operation/key; a different body returns `409 IDEMPOTENCY_KEY_REUSED`. Failed transactions do not store a result and can be retried. A replay represents the original operation; refetch the entity for its current state.

Project edits, lifecycle changes, owner transfers and member removals require the current `version`. Invitation acceptance/removal increments the project version, so refetch before the next edit. Lifecycle transitions are `idea → active/archived`, `active → completed/archived`, `completed → active/archived`, and `archived → idea` for restoration. Archiving revokes pending invitations.

### Route groups

- `GET/PATCH /v1/me`; `GET /v1/me/invitations`.
- `GET /v1/institutions`, `GET /v1/institutions/{id}`.
- `GET/POST /v1/institutions/{id}/verification-requests`; `POST /v1/verification-requests/{id}/decisions`.
- `GET/POST /v1/projects`; `GET/PATCH /v1/projects/{id}`.
- `POST /v1/projects/{id}/lifecycle`; `POST /v1/projects/{id}/ownership-transfer`.
- `GET /v1/projects/{id}/members`; `DELETE /v1/projects/{id}/members/{userId}` with `{ version }`.
- `POST /v1/projects/{id}/invitations`; `GET /v1/invitations/{id}`.
- `POST /v1/invitations/{id}/accept`, `/decline`, `/revoke`.
- `GET /v1/health/live`, `/v1/health/ready`, `/v1/meta`.

The contract is authoritative for exact bodies and response types. Student verification request listings are scoped by RLS: students see their own requests; administrators see requests for their own school. Other-school requests and private projects return 404 where appropriate.

## Database and security boundaries

Application data is in the `app` schema, outside Supabase's normal exposed schema. Keep the Data API disabled for `app`. Runtime connections use **`buildz_api`**, which is not a superuser, table owner or `BYPASSRLS` role; startup refuses privileged database credentials.

Each transaction sets the verified actor ID/email with transaction-local PostgreSQL settings. RLS protects school, project and invitation boundaries even when an API query omits a filter. Context does not leak through pooled connections. Database constraints require the owner to be an accepted member. Scoped security-definer functions handle invitation acceptance and voluntary exit without exposing generic membership writes.

The migration owner and bootstrap operator have separate credentials. Migrations are recorded in `supabase_migrations.schema_migrations`, compatible with the Supabase CLI history; the local runner also records checksums to detect editing an applied migration. Add a new migration instead of changing an applied file. CLI-applied historical migrations without a checksum remain recognised.

The worker connects as `buildz_worker`. It can execute only bounded invitation/booking expiry functions and cannot read student profiles. Audit/outbox events are durable. In-app notifications are inserted transactionally; email/push and SSE are not implemented. No record is falsely marked delivered externally.

Initial rate limiting is 300 requests/minute per directly observed client IP for one API instance. Behind a proxy this can group clients together; configure a trusted edge limiter before a busy public rollout. Never broadly trust arbitrary `X-Forwarded-For` headers. No automatic scheduled deletion of audit/idempotency records is enabled before retention policy is agreed.

## Sharing the application through a link

The intended product is a hosted HTTPS web app. The backend is deployable separately and uses `APP_ORIGIN` to generate links to that web app. The frontend owner must implement `/invitations/:id`, preserve the intended path through sign-in, and configure deep-link refresh handling on their host.

For a hosted deployment, provision Supabase Auth/database, apply migrations, configure the runtime roles, and deploy the API/worker. Set exact frontend HTTPS origins in CORS and Auth redirect allowlists. Users then share the frontend URL; API credentials remain server-side.

Deployment templates and the detailed provisioning sequence are in `deployment.md`. A live external URL has **not** been provisioned by these milestones. Localhost URLs cannot be shared with judges on other devices.

## Verification and remaining work

The suite uses a real PostgreSQL server and signed JWTs with a local JWKS/user endpoint. It checks independent identities, token failures, confirmed email, metadata privilege rejection, RLS/pool isolation, concurrent idempotency, cross-school consent, private reads, stale versions, ownership/exit, expiry and scoped school verification. Runtime responses are validated against the same contract used to generate the SDK.

The additional workflow suite exercises proposal review scopes, safety eligibility, concurrent bookings, cross-resource attendee conflicts, vouchers under contention, cancellation releases, private files, publication isolation, consultation receipts, collaboration consent and moderation. The local demo seed is idempotent and does not overwrite existing edits.

Remaining release work: configure hosting, onboard real Auth identities, push/review the repository through the owner's GitHub workflow, validate the real hosted environment and share its actual HTTPS frontend link. Pilot-only work includes object storage plus malware scanning, external email/push delivery, calendar/SSO integrations, online payments and institution policy/retention review.
