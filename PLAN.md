# Draftly — Status, Review Findings & Backlog

This file tracks verified project status. It replaced the original one-week build plan;
sections 2–3 keep the October 2026 review and its six hardening stages as history, and
section 5 is the live backlog.

**Working rules for every change:** one item at a time; inspect the files again before
changing them; add or update tests; run the validation commands; stop for review.
No dependency upgrades and no commits unless explicitly approved.

---

## 0. Current status (verified 2026-11-03)

All six hardening stages (section 3) are complete. From the 2026-11-03 reconciliation, the P1
items (section 5.1), quick-win Batch 1 (section 5.2), verification (5.3), F1 (the Preferences
page), F2 (CI pipeline), F3 (concurrent generation race), F4 (full thread context), F5 (activity page), F6 (reply all,
`Reply-To`) and F7 (Gmail retries) (5.4) are done: the feature backlog is complete.

| Check | Result |
|---|---|
| Backend typecheck | `npx tsc --noEmit` clean |
| Backend tests | 25 files, **455 passing** (`npm run test:ci`) |
| Backend coverage | 96.41% statements, 87.60% branches, 97.53% functions, 96.41% lines |
| Frontend dependencies | Clean `npm ci` from the lockfile (no `--legacy-peer-deps`): Angular 21.2.25 (CLI/build 21.2.29, pinned exactly), Material 21.2.14 |
| Frontend tests | 7 files, **138 passing** |
| Frontend coverage | 95.79% statements, 82.67% branches, 95.87% functions, 96.22% lines |
| Frontend typecheck | `npx tsc -p tsconfig.app.json --noEmit` clean |
| Production build | `ng build` passes with no warnings; initial bundle 464.48 kB (107.36 kB transferred), under the 500 kB warning budget; Preferences (7.43 kB) and Activity (74 kB, 10.4 kB gzipped) are lazy chunks |
| CI | `.github/workflows/ci.yml` (GitHub Actions, Node from `.nvmrc`): every step passed in a clean checkout (fresh `npm ci`, no `.env`, placeholder env values) |
| Docker | Images rebuilt on `node:24-alpine` (D4): backend runs Node 24.22.2 and loads its compiled app; the frontend image's nginx config is valid (its `backend` upstream resolves inside compose). Earlier `node:20` stack and browser smoke test confirmed by the user |

Verified on Node 24.15.0 locally; the Docker images build and run on Node 24.22.2 (`.nvmrc` holds
`24` since D4; Node 20 reached end-of-life on 2026-04-30).

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
| F2 | ~~**CI pipeline** (GitHub Actions): backend typecheck + `test:ci`, frontend typecheck + tests + `ng build`, on Node 20.19.5.~~ | **Done** 2026-11-03: `.github/workflows/ci.yml` runs on pushes to `master`, pull requests and manual dispatch. Two parallel jobs on Node from `.nvmrc`: backend (`npm ci`, `tsc --noEmit`, `test:ci` with coverage thresholds, placeholder env values, cached MongoDB binary) and frontend (`npm ci`, app typecheck, `test:coverage`, `npm run build`). Coverage reports are uploaded as artifacts. Simulated locally in a clean worktree (Node 24.15); the first run on GitHub happens on the next push. | M |
| F3 | ~~**Concurrent generation race**: two generations for the same thread can both create PENDING drafts.~~ | **Done** 2026-11-03: partial unique index `one_pending_draft_per_thread` (`{userId, threadId}` where `status: PENDING`). `DraftService.savePendingDraft` retires the current pending draft, inserts the new one, and restores the old one if the insert fails; on a duplicate key it reuses the winning draft when it matches the request (same tone, no context), otherwise replaces it (at most 3 attempts, then 409). Startup (`server.ts`) runs `enforceSinglePendingDraftPerThread()`: retires older duplicate PENDING drafts (newest kept, audit `SUPERSEDED` with `reason: duplicate_pending`), then builds the index. Integration tests send simultaneous requests; against the old code they returned 500s. | M |
| F4 | ~~**Full thread context**: thread context and consolidation only see cached messages (ones that appeared in a listing); fetch the thread from Gmail (`threads.get`).~~ | **Done** 2026-11-03: `GmailService.syncThread` fetches the thread (`threads.get`, `format: full`, newest 50 messages) and caches it through `cacheMessage`, the same parsing/upsert the inbox listing now uses. `DraftService.generateDraft` syncs before choosing the reply target (thread requests) and before generating (single-message requests), so `OpenAIService` sees the whole thread without changes. A failed sync (not connected, 403, 429, 5xx) is logged and generation falls back to the cache; `invalid_grant` still marks Gmail disconnected. | M |
| F5 | ~~Activity-log screen.~~ | **Done** 2026-11-03: lazy, guarded `/activity` page (account menu → Activity): entries described in plain language (`shared/activity-format.ts`), filter chips by action, Newer/Older paging (25 per page, from the real `total`), links to each draft, loading/error/empty states; stale responses are ignored when filters change quickly. `GET /api/logs` accepts an optional `action` filter (whitelisted; `total` counts matching logs). A Material paginator was replaced by two buttons, shrinking the page chunk from 122 kB to 74 kB. | M |
| F6 | ~~Reply-all and `Reply-To` support.~~ | **Done** 2026-11-03: `cacheMessage` stores `Cc` and `Reply-To`; `replyRecipients()` (`utils/mimeMessage.ts`) addresses To to `Reply-To` (else the sender) and, with the draft's `replyAll` flag, Cc to the other recipients, removing the user's address and duplicates (max 50). `buildRawReply` writes folded To/Cc lists; `PUT /api/drafts/:id` accepts `replyAll` (synced to the Gmail draft when approved); responses include `recipients` and `canReplyAll`; approve returns 409 when the only address is the user's and 422 without a valid address. The draft page shows To/Cc, a **Reply all** switch, and the Cc in the send confirmation. | M |
| F7 | ~~Retry with backoff for transient Gmail failures.~~ | **Done** 2026-11-03: `utils/retry.ts` (`withRetry`, `parseRetryAfter`) and `GmailService.gmailCall` wrap all eight Gmail API calls: 3 attempts, 0.5 s/1 s backoff with jitter, `Retry-After` honoured up to 4 s (longer waits fail fast as 429). Rate limits (429, 403 `rateLimitExceeded`/`userRateLimitExceeded`) retry on every call; 408/5xx/network errors only on idempotent calls (`messages.list/get`, `threads.get`, `drafts.update/delete`), never on `drafts.create`/`drafts.send` (a repeat could duplicate a draft or a send). Before this, googleapis retried GET/PUT/DELETE silently, never POSTs or 403 rate limits; its retry is now off (`retry: false`) so attempts never multiply. Lasting 403 rate limits map to 429, lasting 5xx/network errors to 503. | M |

### 5.5 Needs approval (dependency changes)

| # | Item | Notes |
|---|---|---|
| D1 | ~~Remove unused `cookie-parser` and `@types/cookie-parser` (backend).~~ | **Done** 2026-11-03 (approved): uninstalled; the lockfile also drops their dependency `cookie-signature@1.0.6` (Express keeps its own 1.2.2) and three optional-peer entries npm 11 no longer records (`zod`, two nested `gcp-metadata`; none are imported). Clean `npm ci`, typecheck, build and all 447 tests pass. |
| D2 | ~~`npm audit` (frontend): 35 vulnerabilities (22 moderate, 10 high, 3 critical).~~ | **Done** 2026-11-03 (approved), no major upgrades. **Frontend 35 → 16** (0 critical, 0 high): Angular framework 21.2.22 → 21.2.25 (fixes the only finding that ships to browsers, three `@angular/router` DoS advisories), CLI/build 21.2.22 → 21.2.29 (undici, vite, piscina), vitest/coverage-v8 4.1.11 → 4.1.12, plus `npm audit fix` for transitive tooling. Angular packages are now pinned exactly (caret ranges let npm mix patch releases, which broke peer resolution; that is why the Dockerfile needed `--legacy-peer-deps`). Removed unused `@angular/animations` and deprecated, unused `@angular/platform-browser-dynamic`. The frontend Dockerfile now uses `npm ci`. **Backend 23 → 9** (lockfile only, within existing ranges): runtime fixes `proxy-addr` 2.0.8 (critical IP spoofing; matters with `TRUST_PROXY=1`), `body-parser` 2.4.0, `qs` 6.17.1, `mongoose` 9.11.4 (prototype pollution), `morgan` 1.12.1, `express-rate-limit` 8.7.3 / `ip-address` 10.7.5. The newer mongoose types needed one `as const` in `DraftService`. Remaining findings: see D5, D6. |
| D5 | Frontend: 16 moderate findings in npm's packaging internals (`pacote`, `sigstore`, `glob`, `minimatch`, …) under `@angular/cli`. | Build-time only (used by `ng add`/`ng update`, not by the app). Fix needs Angular CLI 22 (major); best done with a planned Angular 22 upgrade. |
| D6 | Backend: 9 findings (3 critical) in test tooling: `vitest` 1.6 (`tinypool`, `vite-node`), `vite` 5 (`esbuild`), `@vitest/coverage-v8` (`glob`, `test-exclude`). | Dev/test only (never in the Docker image's `--omit=dev` install). Fix needs vitest 5 / vite 8 (majors); the frontend already uses vitest 4. |
| D3 | ~~Initial bundle 527 kB, above the 500 kB warning budget.~~ | **Done** 2026-11-03 (approved): measured with `ng build --stats-json`. Material was already only in lazy chunks; the removable cost was `@angular/animations` (61 kB), pulled in solely by `provideAnimations()`. Angular Material 21 (and the CDK) no longer use it, and the app has no animation triggers, so the provider is removed: initial 527.41 → 463.86 kB (transfer 123.95 → 107.25 kB), no budget warning, budgets unchanged. What remains is Angular core/router/common, zone.js, rxjs and the prebuilt Material theme CSS (106 kB raw, 8 kB transferred). The unused `@angular/animations` package was uninstalled in D2. |
| D4 | ~~**Move to Node 24 LTS.** Node 20 reached end-of-life on 2026-04-30.~~ | **Done** 2026-11-03 (approved): `.nvmrc` `20.19.5` → `24` (CI's `setup-node` and `nvm use` read it), both Dockerfiles `node:20-alpine` → `node:24-alpine`; docs updated. No dependency changes: every engine range already allows Node 24. Tests and builds pass on 24.15.0; `docker compose build` succeeds (Node 24.22.2 in the image). The first GitHub CI run on Node 24 happens on the next push. |

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
| H1 | nginx security headers | `frontend/nginx.conf` (`location /`, `always`): Content-Security-Policy `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and `server_tokens off`. API responses keep helmet's headers. Production build sets `optimization.styles.inlineCritical: false`: its `onload="this.media='all'"` handler would be blocked by `script-src 'self'` and leave the stylesheet unapplied. `style-src 'unsafe-inline'` remains (Angular injects component styles and inlines the font CSS). Verified on the rebuilt image with curl. No HSTS (HTTP-only Docker setup). |
| H2 | JWT-secret strength check | `validateJwtSecrets` in `config/env.ts`: each secret ≥ 32 characters, not the `.env.example` placeholder, and access ≠ refresh; the backend refuses to start otherwise. The existing `.env` files pass (44-character secrets). |
| H3 | Password policy | New passwords: at least 8 characters, at most 72 UTF-8 bytes (bcrypt truncates longer ones), in the API and the register form. Login does not re-check length, so older 6–7 character passwords keep working. |

**Still deferred:** see section 4 (S5, remaining S12 items, in-memory rate limits).
