# BuildZ M2–M7 integration handoff

The canonical contract is `packages/contracts/openapi.yaml` v0.2.1 (79 operations). `packages/sdk/src/schema.d.ts` is generated from it. Import `createBuildZClient` from `@buildz/sdk`; its base URL is the API origin without `/v1`. No frontend files are owned by this backend implementation.

## Contract conventions

- Use `/v1/meta` feature flags and server-returned project capabilities. `files`, `proposals`, `progress`, `resources`, `availability`, `bookings`, `consultations`, `messages`, `notifications`, `publicProjects` and `vouchers` are available. `liveEvents` stays false.
- Every protected request supplies a current access token. Roles are institution-scoped records from `/v1/me`, not email patterns or editable identity metadata.
- POST command routes marked `x-idempotent` require `params.header['Idempotency-Key']` in the generated SDK. Keep the same key for a network retry of the exact same request. Search/quote operations do not need it.
- Responses are `{data,meta}`; paginated collections include `meta.nextCursor`. Cursor tokens are opaque. A replayed idempotent response is the original result, not a fresh view.
- Pass the current `version` to optimistic decisions/edits. On 409 refresh the entity and ask the user to review the change. Do not silently overwrite.
- Timestamps are ISO-8601 instants; convert to/from the user's timezone at the boundary. Windows have inclusive starts and exclusive ends, so adjacent bookings are allowed.
- Prices are integer minor units (SGD100 = S$1.00), never floating currency amounts. No money is actually collected; the API's quote says `paymentMode: school_managed`.
- Retry-After and X-Request-Id are exposed through CORS. Never insert messages, summaries, evidence labels or names as HTML.

## M2: proposals and evidence

Create/list proposals under `/v1/projects/{id}/proposals`. The request has objectives, requested support and requested minutes. Submission is immediately immutable; a change request is addressed by a new submission. Only one pending proposal per project is allowed.

Lead-school reviewers/admins use `/v1/review/proposals`, `/v1/review/projects` and proposal decisions. A decision grants optional `supervisorId` and `minutesGranted` only when approved. `/v1/institutions/{id}/staff` supplies permitted staff IDs/display names without emails. Reviewers cannot self-approve. An assigned supervisor can review progress and message the project without acquiring membership or ownership.

Progress records contain a summary, minutes spent and up to10 evidence entries. Each evidence entry has label/kind and **exactly one** of `url` (HTTPS) or `fileId` (private project file). Submit through `/v1/projects/{id}/progress`; feedback through `/v1/progress/{id}/reviews`. Evidence from another project cannot be attached, even when the uploader belongs to both projects.

Private files:

1. `POST /v1/projects/{id}/files` with `{name,mimeType,contentBase64}`.
2. Synchronous signature/size validation and a transaction produce ready file metadata (ID, size, hash). There is no background processing state and no malware-scan claim.
3. Reference the ID in progress evidence. List metadata under the project's `/files` endpoint.
4. `GET /v1/files/{id}/content` requires current authorization and returns base64 with metadata. Construct/revoke browser Blob URLs for image display; make PDFs explicit downloads.

Allowed: JPEG, PNG, WebP, PDF; up to2 MiB each and50 MiB per project. SVG/HTML/executable MIME types are not accepted. The content is private PostgreSQL binary data for the bounded hackathon, not a public bucket. Membership removal revokes future reads. Already downloaded copies cannot be revoked. Files are never implicitly included in public project publication. A pilot should move payloads to private object storage with scanning, retention, deletion and per-user quotas.

## M3: resources and bookings

Resource manager/institution-admin controls must match the resource's institution. Resource category, physical location/coordinates, capacity, internal/external hourly rates, opening windows, cross-school policy, safety code and approval policy are server-owned records. Each resource represents one exclusively bookable room/equipment unit; capacity counts attendees, not concurrent unrelated bookings. Model multiple identical machines as separate resources.

`GET /v1/resources` supports category/institution/currency filters, nearest or cheapest sorting, and keyset pagination. Nearest requires latitude+longitude; cheapest requires one currency. Distance is straight-line distance, not walking/travel time. Exact-distance ties are ordered by currency, then price. Location entry is explicit, not background tracking.

`POST /v1/resources/{id}/windows` and `POST /v1/me/availability` replace the **entire** schedule atomically. Before editing, fetch `?all=true` (own availability; resource-manager-only opening windows). Never replace the full schedule from a filtered calendar page. Each list is bounded by the100-window write limit. Existing active bookings must remain contained by replacement resource windows. Read-only calendar queries use startsAt+endsAt, bounded to31 days.

`POST /v1/projects/{id}/build-slots/search` searches up to14 days. Supply resourceId, selected participantIds, desired duration and time bounds. By default all selected members must be free. Optional minimumAttendees and requiredParticipantIds support “any two” or “these specific people.” Results include available selected members. Actual booking attendees must be chosen explicitly; the creator must attend. Only accepted teammates are eligible. Other people's raw availability is not readable through the runtime role; the matching helper exposes only the relevant selected team windows.

Booking sequence:

1. `POST /v1/booking-quotes`: resourceId, projectId, startsAt, endsAt, attendees, optional voucherCode.
2. Show the returned currency/subtotal/discount/total and approval requirement. It is **not** a hold.
3. `POST /v1/bookings`: the same input plus resourceVersion and expectedTotalMinor. The server revalidates eligibility and prices under transaction locks.
4. Handle409 when an interval, attendee, voucher or price changed. Do not charge anything externally.

All attendees need valid affiliation and required safety credentials through the booking end. Cross-school policy is checked for each attendee. Resource exclusion constraints prevent double bookings; attendee locks prevent simultaneous reservations across resources. The maximum booking duration is8 hours; start must be in the next180 days. Pending approval reservations hold the interval until the earlier of24 hours or the start time. The restricted worker releases expired holds and voucher credits. Staff confirmation rechecks safety and membership.

The booking creator/project owner may cancel before it starts; resource managers approve/reject, cancel, and record completion/no-show after it ends. Future reservations must be cancelled before archival or attendee removal/exit. Cancellation still works if a manager deactivates a facility. Price snapshots do not change when catalogue rates change later.

## M4: consultations, messages and notifications

Reviewers/admins create their own consultation slots. Overlapping host slots and double-booked slots are prevented. Students book for a project, receive topic/state plus startsAt/endsAt/location/hostId/hostDisplayName/institutionId in every consultation receipt, and can cancel. The host can mark completion after the end. Booking a consultation does not grant the host private team membership or chat access.

Project messages are visible to accepted members and assigned supervisors only. Fetch newest pages and merge by message ID; do not reverse the history accidentally. Poll messages/notifications every10–15 seconds while the view is visible, stop on sign-out/tab inactivity, and back off on errors/429. There is no SSE/WebSocket endpoint.

Notifications are durable in-app records with recipient-scoped read markers. Project activity and consultation/collaboration outcomes create them transactionally. Staff use their review/resource queues for incoming work. External email/push and read receipts for chat are not implemented. Users share invitation links manually.

## M5: public projects and consent

Anonymous routes: `/v1/public/projects` and `/v1/public/projects/{id}`. No authentication is necessary to browse. The owner publishes a **separately authored** title, summary, tags and “seeking” text using the current private project's version. This does not publish members, availability, messages, proposals, files, reviews or institution approvals. The API returns the configured `/showcase/{id}` frontend link. Refresh both project and publication after edits; their versions are separate.

Unpublish/archive removes anonymous access immediately, though external screenshots cannot be retracted. Lead-school reviewers can remove reported content; an owner cannot bypass an unresolved removal by republishing. A reviewer can dismiss the removal after an appeal; publishing again is then an owner action.

Signed-in visitors request advice or ask to join. No private access exists while pending. The owner accepts/declines; the requester can withdraw. Accepting a **join** request grants only member access (not editor/owner), because both sides have consented. Accepting **advice** only records the owner's response; it never adds membership or unlocks chat. This is the initial consultation channel between strangers. Repeated open requests are bounded to one per requester/project.

## M6: voucher credits

Resource managers/admins create institution-scoped fixed-amount codes with currency, budget, redemption limit and expiry. The institution is that of the booked resource. Eligible signed-in users can discover the published codes; they are not secret access credentials. Quote/create validates them server-side and stores the price snapshot. Resource/project/calendar/voucher locks follow a fixed order. Aggregate credit budgets cannot be overspent by concurrent requests on different resources. Cancelling/rejecting/expiring a booking creates a compensating negative ledger entry; successful historic rows are not rewritten.

Completed/no-show booking credits remain consumed. There is no stored-value wallet, transfer, real payment gateway, percentage discount stacking or cash refund claim. Financial settlement remains with the institution.

## M7 and delivery limits

Backend verification is available through `npm run verify:backend`, the CI workflow and `npm run smoke:backend -- --api <origin> --app <frontend-origin>`. The frontend task owns screens and its browser regression suite. Root `render.yaml` describes a full-stack hosting option without changing frontend code; it does not create services by itself. Follow `shareable-link-guide.md`, review paid plans and configure secrets in host dashboards.

This is the hackathon implementation of the master plan, not a production-school certification. Deferred: external calendar/SSO/email/push, real payments, binary malware scanning, complex recurring calendar/DST rules, travel-time routing, multi-unit pooled inventory, institution policy/consent rollout and retention/deletion controls. Do not present deployment or those integrations as finished until verified separately.
