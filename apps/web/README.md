# BuildZ frontend

React, TypeScript, and Vite frontend integrated with the canonical BuildZ v0.2.1 API and generated SDK. Business data is authorized and persisted by the backend; failed requests never substitute samples or invented success.

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

```sh
npm run typecheck --workspace @buildz/web
npm run build --workspace @buildz/web
npm run test --workspace @buildz/web
npm run test:auth --workspace @buildz/web
```

Install Chromium with npx playwright install chromium. Main tests need the real local backend/demo. Multi-identity scenarios are paced to respect the server's 300-request/minute limit; it is not disabled. Test records are fictional and remain in the local database.

The main suite tests persistence/permissions, invitations/public joins, proposal approval/feedback, booking conflict/approval/cancellation and credit release, consultation receipts/calendar/cancellation, retry-safe messages, private files, outages, version conflicts and throttling. It also tests typing/paste/focus at 15 student/staff form entry points, background draft preservation, sample-to-live navigation, eight widths, motion/forced-color preferences and axe WCAG checks.

Auth tests use a separate temporary frontend on port 5174 and an **intercepted fictional provider**. They verify configured login typing, signup validation/payload/confirmation and recovery callback handling. They do not send email, create real accounts or substitute for hosted Supabase tests.

Latest release-run result: final verification is in progress. The three isolated Auth tests and targeted outage/supervisor-race regressions pass; final counts will be recorded here before handoff.

Source static audit: no high/medium findings; low signals are reviewed native form/modal handling and cleaned-up timers. The spatial audit's block-three match is a false positive: no 3D engine/assets are present, and shared CSS implements reduced motion.

Artifacts (git-ignored): playwright-report, test-results, auth-playwright-report, auth-test-results. Responsive widths: 320, 390, 600, 768, 900, 1024, 1366, 1440px. Budgets: initial JS <160 KB gzip, CSS <15 KB gzip, WOFF2 <110 KB, no continuous animation loop.

Automated checks are evidence, not a zero-bug guarantee or WCAG certification. Unverified locally: physical mobile devices, real screen-reader combinations, Firefox/WebKit, field INP, production email delivery and hosted end-to-end deployment.
