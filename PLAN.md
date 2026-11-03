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
page), F2 (CI pipeline) and F3 (concurrent generation race) (5.4) are done.

| Check | Result |
|---|---|
| Backend typecheck | `npx tsc --noEmit` clean |
| Backend tests | 23 files, **379 passing** (`npm run test:ci`) |
| Backend coverage | 96.20% statements, 85.83% branches, 98.58% functions, 96.20% lines |
| Frontend dependencies | Clean `npm ci` from the lockfile: Angular 21.2.22, Material 21.2.14 (the local install had been a stale Angular 17) |
| Frontend tests | 6 files, **114 passing** |
| Frontend coverage | 95.27% statements, 81.62% branches, 95.26% functions, 95.79% lines |
| Frontend typecheck | `npx tsc -p tsconfig.app.json --noEmit` clean |
| Production build | `ng build` passes; initial bundle 527.12 kB (only the 500 kB warning budget exceeded); Preferences page is a 7.39 kB lazy chunk |
| CI | `.github/workflows/ci.yml` (GitHub Actions, Node from `.nvmrc`): every step passed in a clean checkout (fresh `npm ci`, no `.env`, placeholder env values) |
| Docker | `docker compose up --build` run by the user on 2026-11-03 (images build on `node:20-alpine`); browser smoke test confirmed by the user |

Verified on Node 24.15 (supported by Angular 21); no Node version manager is installed on this
machine, so the pinned 20.19.5 was not re-tested.

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
| S12 | Info | Stateless refresh tokens; tokens in `localStorage`; 6-character minimum password; no JWT-secret strength check; no CSP/security headers in nginx; MongoDB without auth. | **Deferred** (see section 4). |

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
- **S12** items: server-side refresh-token revocation, tokens in `localStorage`, password policy, JWT-secret strength check, nginx CSP/security headers, MongoDB auth.
- **In-memory rate limits** (per backend process).
- **Express 5 async-handler refactor** (A8): broad churn for little gain.
- **Full signals / `OnPush` conversion**: not needed for a zone-based app this size.
- **Sandboxed-iframe email rendering**: script XSS already mitigated; remote images gated.
- **Removing `provideAnimations()`**: only after checking Material 21's needs.

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
| F4 | **Full thread context**: thread context and consolidation only see cached messages (ones that appeared in a listing); fetch the thread from Gmail (`threads.get`). | `GmailService.fetchThreadEmails`, `OpenAIService.generateDraft` | M |
| F5 | Activity-log screen. Low demo value. | `logRoutes.ts` | M |
| F6 | Reply-all and `Reply-To` support. | `buildRawReply` uses the sender only | M |
| F7 | Retry with backoff for transient Gmail failures. | — | M |

### 5.5 Needs approval (dependency changes)

| # | Item | Notes |
|---|---|---|
| D1 | Remove unused `cookie-parser` and `@types/cookie-parser` (backend). | Never imported. |
| D2 | `npm audit` (frontend): 35 vulnerabilities (22 moderate, 10 high, 3 critical). | Fix requires upgrades. |
| D3 | Initial bundle 527 kB, above the 500 kB warning budget. | Investigate (e.g. `provideAnimations()`, Material imports) before changing budgets. |
| D4 | **Move to Node 24 LTS.** Node 20 reached end-of-life on 2026-04-30. Update `.nvmrc` (20.19.5), both Dockerfiles (`node:20-alpine`), and CI (reads `.nvmrc`); `@types/node` is already 25. | Tests and builds already pass on Node 24.15 locally (Angular 21 supports it). Re-run the Docker build and CI after the change. |

### 5.6 Cleanup — not started

| # | Item | Notes |
|---|---|---|
| C-1 | Noisy backend test output (stack traces from failure-path tests; unmocked logger in some suites). | — |
| C-2 | `frontend/tsconfig.spec.json` matches no files (`src/**/*.spec.ts`); tests live in `tests/*.vitest.ts`. | Stale config. |

### 5.7 Deferred security hardening

See section 4 (S5, S12 items, in-memory rate limits).
