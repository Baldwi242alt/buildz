# BuildZ frontend

React, TypeScript, and Vite frontend integrated with the canonical BuildZ v0.3.0 API and generated SDK. Business data is authorized and persisted by the backend; failed requests never substitute samples or invented success.

## Start here

From the repository root:

```sh
npm install
npm run sdk:generate
npm run dev:backend
# In a second terminal:
npm run dev
```

Open http://127.0.0.1:5173. The local, git-ignored apps/web/.env.local sets VITE_BUILDZ_API_BASE_URL=http://127.0.0.1:3001/v1 and VITE_BUILDZ_LOCAL_DEMO=true.

- **Connect to local demo** is the editable real-API workspace. Choose Alice/Bob/Charlie for students or Northstar Staff for administration. Fictional changes persist in the local database. Demo tokens stay in memory; reload requires choosing the actor again.
- **Explore sample workspace** is a separate read-only tour with browser-local drafts. Its persistent **Open connected workspace** action returns to the real-workspace login. Sample projects do not automatically become database projects.
- Email/password fields render only when hosted Auth is configured. Missing configuration is explained instead of showing unusable disabled text boxes. Both development entries are absent from production.

## Integrated scope

| Milestone | Frontend workflows |
| --- | --- |
| M0 | Sign-in/sign-out, signup and email-confirmation guidance, recovery/reset, profiles, school verification requests/review, role-aware navigation |
| M1 | Private projects, search/filter/sort/pagination, editing/lifecycle, membership, invitations and consent, ownership transfer |
| M2 | Proposals, staff decisions/supervisors, time grants, progress journals/feedback, private evidence upload/attachment/download |
| M3 | Resource discovery/detail/management, opening schedules, personal availability, safety-credential display, selected-teammate matching, quotes/approvals/cancellation/attendance, project calendar |
| M4 | Consultation slots/booking/cancellation and durable receipts, private team chat, notifications |
| M5 | Authored public showcases, anonymous discovery, join/advice requests and decisions, reporting/moderation |
| M6 | School-managed voucher creation/deactivation, server-calculated discounts, redemption/release ledger |
| M7 | Type/build checks, browser regression, accessibility/reflow/keyboard checks, retry/privacy checks and hosting handoff |

This follows the implemented hackathon API, not every illustrative endpoint in the planning document. Quotes are not holds; pending requests are not confirmations. Payment is school-managed; no card is charged. Grants are not a remaining-time wallet. Private files are synchronously size/type/signature-validated PNG/JPEG/WebP/PDF (2 MiB each), not malware-scanned. Upload and progress submission are separate. Public showcases do not expose private files, messages, members or proposals.

Meta feature flags gate screens. liveEvents=false: visible-page polling, focus, explicit refresh and mutations refresh authorized records; no SSE endpoint is invented. Matching currently requires all selected attendees. Advanced optional-attendee matching and safety-credential administration remain backend/API capabilities, not separate frontend screens.

## Hosted setup

Set these **build-time public values**; see .env.example:

```text
VITE_BUILDZ_API_BASE_URL=https://<api-host>/v1
VITE_BUILDZ_AUTH_URL=https://<project>.supabase.co
VITE_BUILDZ_AUTH_PUBLISHABLE_KEY=<Supabase publishable key>
```

Never provide a service-role/database credential to the frontend. Configure exact backend CORS/APP_ORIGIN and Supabase Site URL/redirect allowlist. Signup and recovery return to the root /. All application paths, including /showcase/{id}, need SPA fallback. Use HTTPS, keep email confirmation enabled, and configure working custom SMTP before testing public signup/recovery.

Signup sends only display_name profile metadata. No role, institution or permission is inferred from an email. New users request school verification through the workspace. The Backend task owns hosted provisioning and deployment; local tests do not prove either. Development login is loopback-only, uses documented fictional identities and discovers the issuer from API metadata; it is absent from production.

## Recovery and design decisions

- Keyed mutations retain the original key and freeze the submitted intention after an uncertain response. An unknown booking result can be reconciled after the displayed quote expires; new intentions need current terms.
- Version/eligibility/price conflicts preserve drafts and require review. There are no optimistic approvals, credit deductions, reservations or publication successes.
- Temporary bootstrap refresh failures keep open drafts and label cached details potentially stale. Confirmed access/session denials clear private data; scoped reads abort on identity/navigation changes.
- Retry-After is honored across the client and background reads; repeated failures back off. Workflow navigation avoids repeatedly fetching the entire bootstrap.
- Private downloads recheck authorization and use temporary local blob URLs revoked on unmount. Evidence URLs reject unsafe schemes and embedded credentials.
- Applied skills: frontend-design, ui-ux-pro, laws-of-ux, and web-3d-pro value/QA gates. They informed grouped tasks, explicit sample/live boundaries, native editable controls, contrast/target corrections, draft recovery and consent. True 3D adds no task value here; Apple-native/Figma/Sites workflows do not apply.
- The campus-workshop design uses BuildZ casing, ink/teal with mint/peach, self-hosted Space Grotesk/Manrope and lightweight CSS illustrations. No tracking, external imagery or 3D runtime.
- Desktop navigation scrolls independently; mobile navigation is focus-contained and inert when closed. Layouts reflow without horizontal page scrolling. Keyboard, paste, visible focus, reduced motion and forced colors remain supported.

## Verification

### Calendar and mentorship update (2026-09-13)

- Calendar now has a keyboard-operable month grid, project selector and date-specific member availability. The selected 30-minute interval labels each member Free, Busy or Not shared; busy wins and unshared time is never inferred free. Calendar dates and availability windows use the explicitly displayed device timezone.
- Bookings has a separate venue selector and time-slot board. Opening hours and anonymous occupied spans come from the resource calendar API. Closed overnight hours are collapsed by default and can be shown. A free slot opens Plan & book with its resource/start/end filled; this is not a hold or reservation.
- Every accessible project overview has Request for mentorship. Accepted members can request a lead-school mentor whether the project is private or public. Mentors receive the title/message, not private notes/files/team. Request, acceptance and cancellation use persisted, versioned/idempotent API actions; consultations filter project options against the slot host's accepted mentorships. Nonmembers get membership guidance, not private data.
- Owner Private/Public controls retain explicit curated publication review and confirmation. Incoming owner-project collaboration requests appear alongside outgoing requests. Mentorship notifications link to Consultations. Demo campuses are explicitly labelled; synthetic mentors do not impersonate live advisors or automatically accept new requests.
- Verification: **7/7 new targeted tests**, **9/9 baseline UI tests**, and the updated **real consultation receipt/cancellation integration test** passed. The targeted suite includes a real persisted private-project mentorship request → staff acceptance → booking eligibility → cancellation journey; deterministic calendar, failure and nonmember edge cases explicitly intercept only those responses. Calendar reflow checked at 320/390/600/768/1024/1440px; venue at 320/390/768/1440px. Calendar/venue axe checks passed and mobile/desktop screenshots were inspected.
- Production TypeScript/build pass: initial JS **148.36 KB gzip**, CSS **12.22 KB gzip**, unchanged fonts. Source-only static audit: no high/medium findings, 20 reviewed low signals (native form/arrow-key handling and existing cleaned-up timers). Generated Playwright report HTML is not app source. The existing raw-chunk-size advisory remains. This is bounded release regression evidence, not a fresh full-suite run, real-device audit or zero-bug guarantee.

The frontend-design, ui-ux-pro and laws-of-ux skills informed the familiar month interaction, distinct venue slot board, visible unknown states, explicit privacy choices and mobile disclosure of closed hours. Existing BuildZ ink/teal, mint/peach and self-hosted Manrope/Space Grotesk are retained; no extra calendar or animation library is loaded.

### Earlier baseline and running tests

```sh
npm run typecheck --workspace @buildz/web
npm run build --workspace @buildz/web
npm run test --workspace @buildz/web
npm run test:auth --workspace @buildz/web
```

Install Chromium with npx playwright install chromium. Main tests need the real local backend/demo. Multi-identity scenarios are paced to respect the server's 300-request/minute limit; it is not disabled. Test records are fictional and remain in the local database.

The main suite tests persistence/permissions, invitations/public joins, proposal approval/feedback, booking conflict/approval/cancellation and credit release, consultation receipts/calendar/cancellation, retry-safe messages, private files, outages, version conflicts and throttling. It also tests typing/paste/focus at 15 student/staff form entry points, background draft preservation, sample-to-live navigation, eight widths, motion/forced-color preferences and axe WCAG checks.

Auth tests use a separate temporary frontend on port 5174 and an **intercepted fictional provider**. They verify configured login typing, signup validation/payload/confirmation and recovery callback handling. They do not send email, create real accounts or substitute for hosted Supabase tests.

Latest release-run result (2026-09-13): **28/28 main browser tests passed**, including the delayed-first-response/cold-start scenario, plus **3/3 isolated Auth tests passed**. TypeScript checking and the production build pass. The main suite includes actual API/database integration; Auth-provider responses are intercepted as described above.

Free-host readiness: cancellable GET requests allow up to 75 seconds for a sleeping service to wake, and initial loading explains the delay. Mutation timeouts remain 20 seconds with original-key reconciliation. Temporary refresh failures retain drafts; authentication/access denials still clear private data.

Source static audit: no high/medium findings; low signals are reviewed native form/modal handling and cleaned-up timers. The spatial audit's block-three match is a false positive: no 3D engine/assets are present, and shared CSS implements reduced motion.

Artifacts (git-ignored): playwright-report, test-results, auth-playwright-report, auth-test-results. Responsive widths: 320, 390, 600, 768, 900, 1024, 1366, 1440px. Budgets: initial JS <160 KB gzip, CSS <15 KB gzip, WOFF2 <110 KB, no continuous animation loop.

Measured production build: 145.15 KB gzip initial JS, 11.35 KB gzip CSS, 95.97 KB WOFF2 fonts. Vite's non-blocking raw-chunk-size advisory remains; compressed budgets pass. Lighthouse 13.4.1 simulated-mobile lab on the production entry page: performance 98, accessibility 100, LCP 2.0 s, TBT 0 ms, CLS 0.004. This entry-page lab was run without hosted Auth configuration; it is not a signed-in workflow or field-performance claim.

Automated checks are evidence, not a zero-bug guarantee or WCAG certification. Unverified locally: physical mobile devices, real screen-reader combinations, Firefox/WebKit, field INP, production email delivery and hosted end-to-end deployment.
