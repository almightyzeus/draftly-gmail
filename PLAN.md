# Draftly — Status, Review Findings & Backlog

This file tracks verified project status. It replaced the original one-week build plan;
sections 2–3 keep the October 2026 review and its six hardening stages as history, and
section 5 is the live backlog.

**Working rules for every change:** one item at a time; inspect the files again before
changing them; add or update tests; run the validation commands; stop for review.
No dependency upgrades and no commits unless explicitly approved.

---

## 0. Current status (verified 2026-11-12)

All six hardening stages (section 3) are complete. From the 2026-11-03/04 reconciliation, the P1
items (5.1), quick-win Batch 1 (5.2), verification V1–V3 (5.3), features F1–F7 (5.4), dependency
items D1–D4 and D6 (5.5), cleanup C-1 to C-3 (5.6) and security quick wins H1–H3 (5.7) are done.
D5 (Angular 22) was done on 2026-11-11, and the UI and frontend-structure work in 5.8 on
2026-11-11/12. The last release item, R2, was closed on 2026-11-12; nothing is open. Section 6
lists the accepted limitations and what a production deployment would still need.

Local checks re-run on 2026-11-12 (Node 24.15.0, Windows):

| Check | Result |
|---|---|
| Backend typecheck | `npx tsc --noEmit` and `npm run typecheck:tests` clean; `npm run build` passes |
| Backend tests | 25 files, **455 passing** (`npm run test:ci`) |
| Backend coverage | 93.83% statements, 82.69% branches, 96.27% functions, 94.36% lines (Vitest 5 V8 provider, stricter than Vitest 1's; same 36 files) |
| Frontend dependencies | Lockfile installs with plain `npm ci` (no `--legacy-peer-deps`; last clean install 2026-11-03, and in every Docker build since): Angular 22.2.5 (CLI/build 22.2.6, pinned exactly), Material 22.2.6, TypeScript 6.0.3 (2026-11-11); Tailwind CSS 4.3.3, `@fontsource-variable/roboto` 5.3.0 and `material-icons` 1.13.14, pinned exactly (U5, U8) |
| Frontend tests | 9 files, **165 passing** (includes the component-file convention check, the busy overlay, list dates and placeholder rows) |
| Frontend coverage | 95.75% statements, 85.15% branches, 96.68% functions, 96.78% lines |
| Frontend typecheck | `npx tsc -p tsconfig.app.json --noEmit` and `npm run typecheck:tests` clean |
| Production build | `ng build` passes with no warnings; initial bundle 501.49 kB (114.64 kB transferred), under the 550 kB warning budget (raised from 500 kB in U8, when the font CSS moved from `index.html` into the stylesheet); Preferences (7.43 kB) and Activity (76.69 kB, 10.61 kB gzipped) are lazy chunks; the built `index.html` (559 bytes) has no inline event handlers (CSP) and no external links |
| `npm audit` | Backend 0; frontend 0 |

Other verification, with its date:

| Check | Result |
|---|---|
| CI, GitHub-hosted | Checked 2026-11-12 via the GitHub API: the five latest runs passed, the newest on `9f4e9fd` (2026-11-12). Checked 2026-11-05: 12 runs since 2026-11-03; `7dd415b` (2026-11-04) passed. One failure: `9f33ab8` (2026-11-03), backend `npm ci` on Node 20 / npm 10, likely the npm 11-written lockfile (the log needs a login and was not read); all runs since `06577ce` (Node 24) passed. |
| CI, local simulation | 2026-11-03: workflow steps in a clean worktree (fresh `npm ci`, no `.env`, placeholder env values), before the first hosted run |
| Docker | 2026-11-03: both images built on `node:24-alpine` (Node 24.22.2); the backend loaded its compiled app; the frontend nginx config is valid inside compose. 2026-11-04: frontend image rebuilt, security headers checked with curl. 2026-11-11 (R1): both images rebuilt from `a417265` (Node 24.22.2, npm 11.19.1) and the stack started: the backend passed the JWT-secret check (H2) and connected to MongoDB; through nginx the app, a deep link (`/drafts/abc`) and the JS chunks return 200 with all security headers, `/api/drafts` without a token returns 401, and a login with unknown credentials returns 401. The frontend bundle hashes match the local build. Not checked: a browser session (R2). 2026-11-11/12: the frontend image was rebuilt after every 5.8 step and its served bundle hashes matched the local build each time; since U8 the build downloads no fonts (the Google Fonts inlining step had failed intermittently with exit 127). |
| Browser | 2026-11-03: smoke test (V3) confirmed by the user. 2026-11-04: user re-checked the rebuilt stack after D2/D3 (menus, dialogs, snackbars). 2026-11-11/12: every page captured in headless Edge at desktop and phone widths before and after each 5.8 step and compared pixel by pixel, with computed-style probes (Gmail list responses served from a fixture in the browser; no Gmail or OpenAI calls). 2026-11-12: CSP checked in headless Edge on every page, including email images, and by the user through the Connect Gmail flow (R2) |

Node: local runs use 24.15.0; the Docker image ran 24.22.2 when built; `.nvmrc` holds `24`
since D4 (Node 20 reached end-of-life on 2026-04-30).

Previous checkpoint (2026-10-04, Node 20.19.5): backend 23 files / 348 tests, 95.59% statements;
frontend 5 files / 83 tests, 93.87% statements; initial bundle ≈527 kB (over the 500 kB
warning budget, under the 1 MB error budget).

## 1. Baseline (history)

At the start of the October review: backend 18 files / 253 tests (93.09% statements),
frontend 3 files / 36 tests (83.83%), initial bundle 994.85 kB against a 1 MB hard error
budget, Docker working with nginx proxying `/api`.

Completed before the review (preserve):

- Signed, expiring Gmail OAuth state; `FRONTEND_URL` redirects; encrypted Gmail tokens; refresh persistence; Google revocation; `invalid_grant` → account marked disconnected.
- JWT access/refresh tokens; `POST /api/auth/refresh`; interceptor refresh-and-retry once.
- RFC `Message-ID` / `In-Reply-To` / `References` threading; Gmail `threadId` preserved.
- Consolidated thread replies (`replyToGmailMessageId`, all unread messages in the prompt).
- Durable send idempotency: atomic claim on the Draft document, `Idempotency-Key` header (body key still accepted).
- Gmail search + pagination (`q`, `pageToken`, `limit`, `label`, `unread`, `nextPageToken`); frontend search UI with a page-token stack.
- Docker fixes: Angular `browser/` output; brute-force limiter only on failed login/register; `TRUST_PROXY=1`; backend port bound to `127.0.0.1`; session restore no longer hits a circular DI error (NG0200).

---

## 2. Review findings (October 2026) and their status

### 2.1 Security

| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | Medium | Logout did not end the session (JS-readable token cookies accepted by the API). | **Fixed** (Stage 1): Bearer header only; no token cookies; legacy cookies cleared on logout. |
| S2 | Medium | The OAuth `state` JWT was also a valid API access token. | **Fixed** (Stage 1): own audience; `authenticateJWT` rejects tokens with `type`/`aud`. |
| S3 | Medium | OAuth callback used a process-wide OAuth2 client (cross-user credential mixing). | **Fixed** (Stage 1): a fresh client per callback; singleton removed. |
| S4 | Medium | Reply headers built from untrusted input without CR/LF stripping; MIME builder duplicated. | **Fixed** (Stage 2): single `buildRawReply` in `utils/mimeMessage.ts`. |
| S5 | Low | OAuth `state` not bound to the browser that started the flow. | **Deferred** (documented in README). |
| S6 | Low | Direction detected by substring match on `From`. | **Fixed** (Stage 2): `SENT` label or exact address match. |
| S7 | Low | Docker ran in development mode, as root, with dev dependencies. | **Fixed** (Stage 3): `NODE_ENV=production`, two-stage image, `USER node`. |
| S8 | Low | Request log recorded OAuth `code`/`state` and search queries. | **Fixed** (Stage 1): `utils/redact.ts`. |
| S9 | Low | Email HTML rendered inline; remote images loaded automatically. | **Fixed / accepted**: sanitized once per load, remote images hidden until "Show images"; inline rendering (no sandboxed iframe) accepted. |
| S10 | Low | Non-string body fields reached Mongo filters. | **Fixed** (Stage 3): string-only ids and inputs with length caps. |
| S11 | Low | No OpenAI cost or abuse bounds. | **Fixed** (Stage 3): per-user generate limit, prompt caps, timeout. |
| S12 | Info | Stateless refresh tokens; tokens in `localStorage`; 6-character minimum password; no JWT-secret strength check; no CSP/security headers in nginx; MongoDB without auth. | **Partly fixed** 2026-11-04 (section 5.7): password policy, JWT-secret check, nginx CSP and headers. The rest is deferred (section 4). |

### 2.2 Correctness

| # | Finding | Status |
|---|---|---|
| C1 | Editing an APPROVED draft could diverge from what Gmail sends. | **Fixed** (Stage 2): Gmail sync first, conditional Mongo update. |
| C2 | Approve with unsaved edits was racy. | **Fixed** (Stage 2): save then approve (`switchMap`). |
| C3 | Not-found/ownership failures returned 500. | **Fixed** (Stage 3): typed errors, 404/409. |
| C4 | Empty OpenAI response saved as a placeholder draft. | **Fixed** (Stage 2): 502, nothing saved. |
| C5 | `internalDate` came from the sender-controlled `Date` header. | **Fixed** (Stage 2): Gmail `internalDate`. |
| C6 | HTML-only emails gave the AI no content. | **Fixed** (2026-10-04): `utils/htmlToText.ts`. |
| C7 | Dashboard user subscription leaked; double initial inbox fetch. | **Fixed** (Stage 4): explicit unsubscribe in `ngOnDestroy` (not `takeUntilDestroyed` as planned); single initial load. |

### 2.3 Architecture

| # | Item | Status |
|---|---|---|
| A1 | Duplicated controller error handling. | **Fixed**: shared `sendError` in `utils/errors.ts`. |
| A2 | Duplicated MIME builder. | **Fixed** with S4. |
| A3 | Dead code (backend and frontend). | **Fixed** (Stage 3/4). |
| A4 | OpenAI config bypassed `env`. | **Fixed**: `env.openai`, 60 s timeout, 2 retries. |
| A5 | Initial bundle 5 kB below the 1 MB hard limit. | **Fixed** (Stage 4): lazy routes (≈527 kB). |
| A6 | Sequential Gmail `messages.get` (N+1). | **Fixed**: 10 in parallel (`utils/concurrency.ts`). |
| A7 | Unused `zod` and `joi`. | **Fixed** (2026-10-04): removed. |
| A8 | `try/catch` in every controller despite Express 5. | **Left as is** by decision. |

### 2.4–2.6 Frontend, Angular/RxJS, tests

All items from the review were addressed in Stages 4–5: drafts list (Dashboard **Drafts**
tab), Material confirm dialog instead of `confirm()`, snackbars, `mat-form-field` draft
editor, accessibility (aria-labels, keyboard rows, `autocomplete`, app title), shared global
styles, responsive inbox table, observer-object subscriptions, signal-based busy state in
DraftDetail. Frontend tests still construct component classes directly (no template or
rendering assertions); accepted at this size.

---

## 3. Completed stages (history)

| Stage | Outcome |
|---|---|
| 1 Session & OAuth hardening (S1, S2, S3, S8) | Header-only auth, `GET /api/gmail/oauth/url`, OAuth state audience, per-callback OAuth client, redacted request logs. |
| 2 Draft & send integrity (C1, C2, S4, S6, C4, C5) | Hardened MIME builder, Gmail-sync-before-save, save-before-approve/send, exact direction detection, no placeholder drafts, Gmail `internalDate`. |
| 3 Errors, config, dead code (C3, A1, A3, A4, S7, S10, S11) | Typed errors and status codes, input caps, per-user generate limit, OpenAI config/timeout/caps, dead code removed, production Docker as non-root. |
| 4 Frontend structure (A5, C7, S9) | Lazy routes (995 kB → 523 kB), observer subscriptions, dashboard leak fixed, signal busy state, safer email rendering. |
| 5 UI/UX polish | Top bar with Gmail status, Inbox/Drafts tabs, drafts list, recipient header, confirm dialogs, snackbars, global styles, accessibility, responsive layouts. |
| 6 Verification & docs | Full validation suite, Docker checks, README / frontend README / SETUP.md / `.env.example` updated. |

Fixes added during the stages: reject on an APPROVED draft withdraws it and deletes its Gmail
copy; malformed/oversized JSON → 400/413; replies can never be addressed to the user;
deprecated Mongoose `new: true` replaced with `returnDocument: 'after'`.

---

## 4. Deferred by decision

- **S5** OAuth state browser binding: low risk for a local app; documented.
- **S12** items: server-side refresh-token revocation, tokens in `localStorage`, MongoDB auth. (Password policy, JWT-secret check and nginx CSP/headers were done on 2026-11-04, section 5.7.)
- **In-memory rate limits** (per backend process).
- **Express 5 async-handler refactor** (A8): broad churn for little gain.
- **Full signals / `OnPush` conversion**: not needed for a zone-based app this size.
- **Sandboxed-iframe email rendering**: script XSS already mitigated; remote images gated.
- ~~**Removing `provideAnimations()`**~~: done in D3 (Material 21 does not use it).

---

## 5. Backlog (from the 2026-11-03 reconciliation)

### 5.1 P1 — correctness / demo-visible — **done 2026-11-03**

| # | Item | Resolution |
|---|---|---|
| P1-1 | Expired Gmail grant (`invalid_grant`) and Gmail 429 were only mapped on the inbox list; approve/edit/send/reject returned a generic 500 and did not mark Gmail disconnected. | `GmailService.toGmailError` applied to every Gmail call (`createDraft`, `updateDraft`, `sendDraft`, `deleteDraft`, `getReplyMetadata`, list). Editing an approved draft keeps 403/429 instead of 502. |
| P1-2 | OAuth callback errors redirected to `/login?error=…`, which the login page ignored; a cancelled Google consent returned raw JSON 400; login ignored `returnUrl`. | Callback always redirects to `/dashboard?gmailError=<code>` (`access_denied`, `missing_code`, `state_expired`, `state_invalid`, `connection_failed`); the dashboard shows a dismissible message and clears the code; login honours an in-app `returnUrl` (absolute, `//` and `/\` URLs rejected). |
| P1-3 | Generating again with a different tone or new context silently returned the old PENDING draft. | Same tone and no context → reuse (double-click safe). Otherwise generate a new draft, then mark the old PENDING one `REJECTED` with audit action `SUPERSEDED` (activity `DRAFT_SUPERSEDED`). A failed generation keeps the old draft. |
| P1-4 | Flaky backend suites (in-memory MongoDB 10 s launch timeout); `npm run test:ci` failed (`--threads` removed in vitest 1.x). | `tests/helpers/mongoMemory.ts` (60 s launch timeout) used by all Mongo suites; `hookTimeout` 90 s; `test:ci` is `vitest run --coverage` (file parallelism is already off in `vitest.config.ts`). |

### 5.2 Batch 1 — quick wins — **done 2026-11-03**

| # | Item | Resolution |
|---|---|---|
| Q1 | `defaultTone` preference was stored but never applied. | Generation without a tone uses `defaultTone` (`formal` if none); the email page preselects it (frontend `PreferenceService`) and never overrides a tone the user already picked. |
| Q2 | On a 403 (Gmail expired) from approve/edit/send/reject, the draft page did not update shared state, so the top bar kept showing Gmail as connected. | DraftDetail calls `AuthService.setGoogleConnected(false)` on a 403. |
| Q3 | Cookie-era leftovers: frontend `withCredentials: true` and XSRF config; backend CORS `credentials: true`. | Removed (auth is the Bearer header only). |
| Q4 | `GET /api/logs` (and the entity variant) returned the page size as `total`. | `total` is a real `countDocuments` count. |
| Q5 | `fetchEmails`, `createDraft` and `updateDraft` loaded the Gmail account twice; the cached copy of a sent reply stored raw text as `bodyHtml`. | One account lookup (`getGmailContext`); sent copy stores the same escaped HTML as the sent message. |
| Q6 | `.env.example` listed only the `gmail.modify` scope. | Lists `gmail.readonly`, `gmail.modify`, `gmail.send`. |

### 5.3 Verification — **done 2026-11-03**

| # | Item | Size |
|---|---|---|
| V1 | ~~Clean `npm ci` in `frontend/` (stale Angular 17 install).~~ | **Done** 2026-11-03 |
| V2 | ~~`docker compose up --build`, building on Node 20.~~ | **Done** 2026-11-03 (run by the user). Both images build on `node:20-alpine`; the test suites themselves have only run on Node 24.15 (no Node version manager on the dev machine). |
| V3 | ~~Browser smoke test: connect Gmail, cancel on Google's screen, generate, approve and send one real reply.~~ | **Done** 2026-11-03 (confirmed by the user). |

### 5.4 Features

| # | Item | Evidence | Size |
|---|---|---|---|
| F1 | ~~**Preferences page** (default tone, signature, style-example count).~~ | **Done** 2026-11-03: lazy, guarded `/preferences` page (account menu → Preferences) with validation matching the API, save, and a discard-changes confirmation. `GET`/`PUT /api/preferences` create the defaults atomically (upsert) for a user without stored preferences instead of returning 404. | M |
| F2 | ~~**CI pipeline** (GitHub Actions): backend typecheck + `test:ci`, frontend typecheck + tests + `ng build`, on Node 20.19.5.~~ | **Done** 2026-11-03: `.github/workflows/ci.yml` runs on pushes to `master`, pull requests and manual dispatch. Two parallel jobs on Node from `.nvmrc`: backend (`npm ci`, `tsc --noEmit`, `test:ci` with coverage thresholds, placeholder env values, cached MongoDB binary) and frontend (`npm ci`, app typecheck, `test:coverage`, `npm run build`). Coverage reports are uploaded as artifacts. Simulated locally in a clean worktree (Node 24.15) before the first push; first GitHub-hosted run: `a66483f` (2026-11-03), passed. | M |
| F3 | ~~**Concurrent generation race**: two generations for the same thread can both create PENDING drafts.~~ | **Done** 2026-11-03: partial unique index `one_pending_draft_per_thread` (`{userId, threadId}` where `status: PENDING`). `DraftService.savePendingDraft` retires the current pending draft, inserts the new one, and restores the old one if the insert fails; on a duplicate key it reuses the winning draft when it matches the request (same tone, no context), otherwise replaces it (at most 3 attempts, then 409). Startup (`server.ts`) runs `enforceSinglePendingDraftPerThread()`: retires older duplicate PENDING drafts (newest kept, audit `SUPERSEDED` with `reason: duplicate_pending`), then builds the index. Integration tests send simultaneous requests; against the old code they returned 500s. | M |
| F4 | ~~**Full thread context**: thread context and consolidation only see cached messages (ones that appeared in a listing); fetch the thread from Gmail (`threads.get`).~~ | **Done** 2026-11-03: `GmailService.syncThread` fetches the thread (`threads.get`, `format: full`, newest 50 messages) and caches it through `cacheMessage`, the same parsing/upsert the inbox listing now uses. `DraftService.generateDraft` syncs before choosing the reply target (thread requests) and before generating (single-message requests), so `OpenAIService` sees the whole thread without changes. A failed sync (not connected, 403, 429, 5xx) is logged and generation falls back to the cache; `invalid_grant` still marks Gmail disconnected. | M |
| F5 | ~~Activity-log screen.~~ | **Done** 2026-11-03: lazy, guarded `/activity` page (account menu → Activity): entries described in plain language (`shared/activity-format.ts`), filter chips by action, Newer/Older paging (25 per page, from the real `total`), links to each draft, loading/error/empty states; stale responses are ignored when filters change quickly. `GET /api/logs` accepts an optional `action` filter (whitelisted; `total` counts matching logs). A Material paginator was replaced by two buttons, shrinking the page chunk from 122 kB to 74 kB. | M |
| F6 | ~~Reply-all and `Reply-To` support.~~ | **Done** 2026-11-03: `cacheMessage` stores `Cc` and `Reply-To`; `replyRecipients()` (`utils/mimeMessage.ts`) addresses To to `Reply-To` (else the sender) and, with the draft's `replyAll` flag, Cc to the other recipients, removing the user's address and duplicates (max 50). `buildRawReply` writes folded To/Cc lists; `PUT /api/drafts/:id` accepts `replyAll` (synced to the Gmail draft when approved); responses include `recipients` and `canReplyAll`; approve returns 409 when the only address is the user's and 422 without a valid address. The draft page shows To/Cc, a **Reply all** switch, and the Cc in the send confirmation. | M |
| F7 | ~~Retry with backoff for transient Gmail failures.~~ | **Done** 2026-11-03: `utils/retry.ts` (`withRetry`, `parseRetryAfter`) and `GmailService.gmailCall` wrap all eight Gmail API calls: 3 attempts, 0.5 s/1 s backoff with jitter, `Retry-After` honoured up to 4 s (longer waits fail fast as 429). Rate limits (429, 403 `rateLimitExceeded`/`userRateLimitExceeded`) retry on every call; 408/5xx/network errors only on idempotent calls (`messages.list/get`, `threads.get`, `drafts.update/delete`), never on `drafts.create`/`drafts.send` (a repeat could duplicate a draft or a send). Before this, googleapis retried GET/PUT/DELETE silently, never POSTs or 403 rate limits; its retry is now off (`retry: false`) so attempts never multiply. Lasting 403 rate limits map to 429, lasting 5xx/network errors to 503. | M |

### 5.5 Needs approval (dependency changes)

| # | Item | Notes |
|---|---|---|
| D1 | ~~Remove unused `cookie-parser` and `@types/cookie-parser` (backend).~~ | **Done** 2026-11-03 (approved): uninstalled; the lockfile also drops their dependency `cookie-signature@1.0.6` (Express keeps its own 1.2.2) and three optional-peer entries npm 11 no longer records (`zod`, two nested `gcp-metadata`; none are imported). Clean `npm ci`, typecheck, build and all 447 tests pass locally (Node 24.15 / npm 11). **The hosted CI run for this commit (`9f33ab8`) failed** at the backend `npm ci` (CI still used Node 20 / npm 10, which likely expected those pruned entries); it was not re-run, and passed from the next commit (D4, Node 24) on. |
| D2 | ~~`npm audit` (frontend): 35 vulnerabilities (22 moderate, 10 high, 3 critical).~~ | **Done** 2026-11-03 (approved), no major upgrades. **Frontend 35 → 16** (0 critical, 0 high): Angular framework 21.2.22 → 21.2.25 (fixes the only finding that ships to browsers, three `@angular/router` DoS advisories), CLI/build 21.2.22 → 21.2.29 (undici, vite, piscina), vitest/coverage-v8 4.1.11 → 4.1.12, plus `npm audit fix` for transitive tooling. Angular packages are now pinned exactly (caret ranges let npm mix patch releases, which broke peer resolution; that is why the Dockerfile needed `--legacy-peer-deps`). Removed unused `@angular/animations` and deprecated, unused `@angular/platform-browser-dynamic`. The frontend Dockerfile now uses `npm ci`. **Backend 23 → 9** (lockfile only, within existing ranges): runtime fixes `proxy-addr` 2.0.8 (critical IP spoofing; matters with `TRUST_PROXY=1`), `body-parser` 2.4.0, `qs` 6.17.1, `mongoose` 9.11.4 (prototype pollution), `morgan` 1.12.1, `express-rate-limit` 8.7.3 / `ip-address` 10.7.5. The newer mongoose types needed one `as const` in `DraftService`. Remaining findings: see D5, D6. |
| D5 | ~~Frontend: 16 moderate findings in npm's packaging internals (`pacote`, `sigstore`, `glob`, `minimatch`, …) under `@angular/cli`.~~ | **Done** 2026-11-11 (approved): Angular 21 → 22 with `ng update` (framework 22.2.5, CLI/build 22.2.6, Material/CDK 22.2.6, TypeScript 5.9 → 6.0). Migrations keep the old behaviour: every component is pinned to `ChangeDetectionStrategy.Eager` (Angular 22's default is OnPush), `provideHttpClient` gets `withXhr()`, and two new template diagnostics are suppressed in `tsconfig.app.json`. Removed the unused `baseUrl` from `tsconfig.json` (deprecated in TypeScript 6). Frontend audit 16 → 0; 138 tests pass; build passes with no warnings (initial 476.77 kB). Docker images rebuilt and checked on 2026-11-11 (R1). |
| D6 | ~~Backend: 9 findings (3 critical) in test tooling: `vitest` 1.6 (`tinypool`, `vite-node`), `vite` 5 (`esbuild`), `@vitest/coverage-v8` (`glob`, `test-exclude`).~~ | **Done** 2026-11-04 (approved): `vitest` and `@vitest/coverage-v8` 1.6.1 → 5.0.5 (pinned exactly; 5.1.0 was two days old), `vite` 5.4.21 → 8.3.5, and `tsx` 4.21.0 → 4.23.15 (its esbuild 0.27 had the last, low finding). **Backend audit: 0 vulnerabilities.** `vitest.config.ts` needed no changes. Since Vitest 4, a mock called with `new` must have a `function`/`class` implementation (`mockReturnValue` or an arrow throws), so 20 constructor mocks (`ActivityLog`, `Draft`, `User`, `OpenAI`) were converted; one `mock.calls` annotation adjusted for the new mock types. All 455 tests pass; coverage figures dropped (93.83% statements) only because the V8 provider now measures more strictly (same files, thresholds unchanged and met). Hosted CI on `7dd415b` (includes this commit) passed. The backend Docker image was rebuilt with this lockfile on 2026-11-11 (R1). |
| D3 | ~~Initial bundle 527 kB, above the 500 kB warning budget.~~ | **Done** 2026-11-03 (approved): measured with `ng build --stats-json`. Material was already only in lazy chunks; the removable cost was `@angular/animations` (61 kB), pulled in solely by `provideAnimations()`. Angular Material 21 (and the CDK) no longer use it, and the app has no animation triggers, so the provider is removed: initial 527.41 → 463.86 kB (transfer 123.95 → 107.25 kB), no budget warning, budgets unchanged. What remains is Angular core/router/common, zone.js, rxjs and the prebuilt Material theme CSS (106 kB raw, 8 kB transferred). The unused `@angular/animations` package was uninstalled in D2. |
| D4 | ~~**Move to Node 24 LTS.** Node 20 reached end-of-life on 2026-04-30.~~ | **Done** 2026-11-03 (approved): `.nvmrc` `20.19.5` → `24` (CI's `setup-node` and `nvm use` read it), both Dockerfiles `node:20-alpine` → `node:24-alpine`; docs updated. No dependency changes: every engine range already allows Node 24. Tests and builds pass on 24.15.0; `docker compose build` succeeds (Node 24.22.2 in the image). First GitHub-hosted run on Node 24: `06577ce` (2026-11-03), passed. |

### 5.6 Cleanup

| # | Item | Notes |
|---|---|---|
| C-1 | ~~Noisy backend test output (stack traces from failure-path tests; unmocked logger in some suites).~~ | **Done** 2026-11-03: the logger is `silent` when `NODE_ENV=test` (new optional `LOG_LEVEL` overrides it in any environment); dotenv's "injected env" tip is off (`quiet: true`, also in production logs). Two suites mocked the logger with a path that did not take effect and one env mock lacked `nodeEnv`; both fixed. A full run prints no log lines or stack traces. |
| C-2 | ~~`frontend/tsconfig.spec.json` matches no files (`src/**/*.spec.ts`); tests live in `tests/*.vitest.ts`.~~ | **Done** 2026-11-03: `tsconfig.spec.json` now type-checks the Vitest suites (`npm run typecheck:tests`, also a CI step); the 4 errors it found are fixed (`runInInjectionContext` instead of the internal `Injector.runInContext`, one non-null assertion). The Karma `test` target in `angular.json` is removed (Karma is not installed; `ng test` could not run). |
| C-3 | ~~Backend tests are not type-checked (`tsconfig.json` excludes `tests/`); including them reports 41 errors in 8 files (mostly loose mock typing in controller tests).~~ | **Done** 2026-11-04: `backend/tsconfig.spec.json` type-checks `src` + `tests` (`npm run typecheck:tests`, also a CI step; `lib` ES2022 since tests run on Node 24). 45 errors fixed: 19 relative imports without `.js` (NodeNext; 13 extensionless `vi.mock` paths aligned too), 14 untyped empty arrays, the `User` mock's static methods, the `NextFunction` mock, `as const` for Draft enum fields in an integration test, and one real test bug it exposed (a log-level test used `'debug'`, which the `ActivityLog` schema rejects). All 455 tests pass. |

### 5.7 Security hardening

**Quick wins — done 2026-11-04:**

| # | Item | Result |
|---|---|---|
| H1 | nginx security headers | `frontend/nginx.conf` (`location /`, `always`): Content-Security-Policy `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `server_tokens off`. API responses keep helmet's headers. Production build sets `optimization.styles.inlineCritical: false`: its `onload="this.media='all'"` handler would be blocked by `script-src 'self'` and leave the stylesheet unapplied. `style-src 'unsafe-inline'` remains (Angular injects component styles and inlines the font CSS). Verified on the rebuilt frontend image with curl (headers on `/` and SPA routes, no inline handlers); no browser-console check for CSP violations recorded yet. No HSTS (HTTP-only Docker setup). **Update 2026-11-12 (U3, U8):** the headers live in `frontend/security-headers.conf`, included in every app location of `nginx.conf`; the fonts are self-hosted, so the CSP is now `style-src 'self' 'unsafe-inline'; font-src 'self'` (no Google hosts), and `'unsafe-inline'` remains only for Angular's injected component styles. |
| H2 | JWT-secret strength check | `validateJwtSecrets` in `config/env.ts`: each secret ≥ 32 characters, not the `.env.example` placeholder, and access ≠ refresh; the backend refuses to start otherwise. The existing `.env` files pass (44-character secrets; lengths checked, values not read). Unit-tested; the rebuilt backend image started with the Docker `.env` on 2026-11-11 (R1). |
| H3 | Password policy | New passwords: at least 8 characters, at most 72 UTF-8 bytes (bcrypt truncates longer ones), in the API and the register form. Login does not re-check length, so older 6–7 character passwords keep working. |

**Still deferred:** see section 4 (S5, remaining S12 items, in-memory rate limits) and section 6.

### 5.8 UI and frontend structure — **done 2026-11-11/12**

Requested by the user after D5, one commit per step, each checked on the rebuilt Docker stack.
Pure restyling steps were verified as pixel-identical before/after (headless Edge screenshots
at desktop and phone widths plus computed-style probes); intended changes are listed.

| # | Item | Result |
|---|---|---|
| U1 | Inline component templates and styles (`a2f6824`) | Every component uses `templateUrl` (and `styleUrls` only when needed); `tests/conventions.vitest.ts` fails `npm test` on an inline `template:`/`styles:` or a missing file. |
| U2 | Full-page busy overlay instead of button spinners (`2a907c7`, `34a0388`, `9a9ef06`) | `BusyOverlayComponent` for approve, send, reject, save, generate, sign in, register and saving preferences: 300 ms show delay (0 for generate), 400 ms minimum, focus trap, screen-reader announcement, optional "still working" message after 4 s. |
| U3 | Response times and caching (`b47d3a3`) | Backend request log ends with `:response-time ms`. nginx: `index.html` `no-cache`, hashed build files `max-age=31536000, immutable`; security headers moved to `security-headers.conf`, included in each location. |
| U4 | Material theme from Sass (`3d31e94`) | `src/theme.scss` (M2 indigo/pink, same output as the prebuilt CSS) plus the `--mat-sys-*` variables; `--dr-*` tokens point at them where they match. |
| U5 | Tailwind CSS 4 (`749cb70` to `4f709e7`) | Utilities next to Material: no preflight, unlayered utilities, theme colours only (default palette removed), templates-only scanning, a `phone:` variant (up to 600px). Every page moved off its component CSS; shared patterns became `<app-state>` and `<app-status-badge>`; `styles.css` holds only design tokens. Each step pixel-identical. |
| U6 | Bugs found while restyling (`54631cd`, `e4d9d22`, `4ef27dd`, `ab460c5`, `497de05`) | Account-menu header layout and the Connect Gmail outline (never applied); images and tables in email HTML not fitted to the card; earlier-year list dates cut off ("Dec 24, …"; now "12/24/25" with the full date on hover, phone date column 76 → 84px); Preferences hints overlapping the next field at phone width; Approve/Send wrapping alone onto its own line at phone width. |
| U7 | Dashboard layout (`79a8526`, `9f4e9fd`) | Width up to 1600px (other pages keep 860px). The list card fills the window below the top bar and still grows with the list (page scroll, no inner scroll). Pulsing placeholder rows inside the real table replace the spinner on first load (10 rows), refresh and paging (as many rows as were listed), for inbox and drafts; hidden from screen readers, which hear "Loading emails…"; no pulse with reduced motion. |
| U8 | Self-hosted fonts (`385dfd8`) | `@fontsource-variable/roboto` (byte-identical to the file Google Fonts serves) and `material-icons` (the same icon font, with its `.material-icons` class). Fixes the Docker build that failed intermittently while inlining Google Fonts; the app makes no requests to Google Fonts; CSP tightened (see H1). Bold text now renders with Roboto's true 600/700 weights instead of a synthesised bold; regular text and icons are pixel-identical. Initial-bundle warning budget 500 → 550 kB. |

---

## 6. Release readiness (reviewed 2026-11-05)

### 6.1 Release items

| # | Item | Notes |
|---|---|---|
| R2 | ~~Browser-console check of the CSP (H1; tightened in U8).~~ | **Done** 2026-11-12. Automated part (headless Edge over CDP against the Docker stack, temporary user deleted afterwards): sign in, register, dashboard (inbox, drafts, account menu), an HTML email before and after **Show images** (remote https image loaded; the only cross-origin request, made only after the click), draft page, preferences with the discard dialog, activity. No `securitypolicyviolation` events, no CSP or other console errors or warnings, no blocked requests, no exceptions; `Roboto Variable` and `Material Icons` loaded from the app itself. Connect Gmail checked manually by the user in Edge with the console open, through Google sign-in and back to the dashboard: no CSP errors from the app; the only messages came from a browser extension (its content script, and an injected `antd` stylesheet whose source map DevTools could not fetch under `connect-src 'self'`). |

### 6.2 Accepted limitations

These are known and documented, and acceptable for a local, single-user demo:

- Send idempotency is at-most-once, not exactly-once: after a crash between Gmail accepting the message and MongoDB recording it, the draft is blocked for the 5-minute claim lease (send/edit/reject → 409), then the next send attempt gets Gmail's 404 for the used draft id, a generic 500, and the draft stays `APPROVED` although the email was delivered. No double send is possible. (Reviewed 2026-11-05; matches `DraftService.sendDraft` and `tests/sendIdempotency.test.ts`.)
- Thread context limited to the newest 50 messages (prompt: 20); cache fallback when Gmail is unreachable.
- Sanitized inline email HTML (no sandboxed iframe); OAuth `state` not browser-bound (S5).
- Google **Testing**-mode refresh tokens expire after 7 days (reconnect).
- Drafts tab limited to 50; activity log records draft actions only.

### 6.3 Production deployment requirements (not done)

Session lifecycle (reviewed 2026-11-05): `POST /api/auth/refresh` returns a new access token and a
new 7-day refresh token but invalidates nothing; there is no logout endpoint (logout only clears
`localStorage`); so a copied refresh token can be renewed indefinitely until `JWT_REFRESH_SECRET`
changes or the user is deleted. Google tokens are separate: **Disconnect Gmail** revokes them at
Google; logout leaves Gmail connected.

| # | Requirement |
|---|---|
| P-1 | Server-side refresh tokens: stored (hashed) with real rotation and reuse detection, a logout endpoint that revokes them, and invalidation on password change. |
| P-2 | Tokens out of `localStorage` (e.g. `HttpOnly`, `Secure`, `SameSite` cookies plus CSRF protection). |
| P-3 | HTTPS everywhere, HSTS, and HTTPS OAuth redirect URI / `FRONTEND_URL`. |
| P-4 | MongoDB authentication, TLS, backups. |
| P-5 | Secrets from a secrets manager; a published (verified) Google OAuth app. |
| P-6 | Rate limits in a shared store (Redis or similar) for restarts and multiple instances. |
| P-7 | Monitoring/alerting, log shipping, automated deployment. |
| P-8 | Send recovery: after a stale claim, detect a message Gmail already sent (thread/Sent lookup) and mark the draft `SENT` instead of returning 500. |
