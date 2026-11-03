# Draftly — Status, Review Findings & Backlog

This file tracks verified project status. It replaced the original one-week build plan;
sections 2–3 keep the October 2026 review and its six hardening stages as history, and
section 5 is the live backlog.

**Working rules for every change:** one item at a time; inspect the files again before
changing them; add or update tests; run the validation commands; stop for review.
No dependency upgrades and no commits unless explicitly approved.

---

## 0. Current status (verified 2026-11-03)

All six hardening stages (section 3) are complete, and the P1 backlog items from the
2026-11-03 reconciliation (section 5.1) are fixed.

| Check | Result |
|---|---|
| Backend typecheck | `npx tsc --noEmit` clean |
| Backend tests | 23 files, **366 passing** (`npm run test:ci`) |
| Backend coverage | 96.23% statements, 85.42% branches, 99.24% functions, 96.23% lines |
| Frontend tests | 5 files, **91 passing** |
| Frontend coverage | 97.73% statements, 90.51% branches, 95.9% functions, 97.73% lines |
| Frontend typecheck / `ng build` | **Not verified**: local `frontend/node_modules` has Angular 17.3.12 while `package.json` requires `^21` (stale install). `tsc` fails only on `provideAppInitializer` (an Angular 19+ API) for that reason. Needs `nvm use && npm ci` in `frontend/`. |
| Docker | Not re-run since 2026-10-04 |

Verified on Node 24.15 (not the pinned 20.19.5).

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

### 5.2 P2 — functional gaps — not started

| # | Item | Evidence |
|---|---|---|
| P2-1 | `defaultTone` preference is stored but never applied (controller and frontend default to `formal`). | `draftController.generateDraft`; `email-detail.component.ts` `selectedTone` |
| P2-2 | No Preferences screen (signature, style-example count only via API); no activity-log screen. | `preferenceRoutes.ts`, `logRoutes.ts` have no frontend client |
| P2-3 | Thread context and consolidation only see cached messages (ones that appeared in a listing). | `GmailService.fetchThreadEmails`, `OpenAIService.generateDraft` |
| P2-4 | No CI pipeline (no `.github/`). Should run typecheck, `test:ci` and `ng build` on Node 20.19.5. | — |
| P2-5 | When approve/edit/send gets 403 (Gmail expired), the draft page shows the message but does not update shared state; the top bar shows **Connect Gmail** only after the next inbox load. | `draft-detail.component.ts` (no `AuthService.setGoogleConnected`) |
| P2-6 | Two concurrent generations for the same thread can still both create PENDING drafts (no unique constraint). | `DraftService.generateDraft` |

### 5.3 P3 — deferred security hardening

See section 4 (S5, S12, in-memory rate limits).

### 5.4 P4 — cleanup — not started

| # | Item | Notes |
|---|---|---|
| P4-1 | `cookie-parser` and `@types/cookie-parser` installed but never imported. | Dependency change: needs approval. |
| P4-2 | Frontend still sets `withCredentials: true` and XSRF configuration (cookie-era leftovers). | `auth.interceptor.ts`, `app.config.ts` |
| P4-3 | `GET /api/logs` returns `total` as the page size, not the real total. | `logController.ts` |
| P4-4 | `fetchEmails` loads the Gmail account twice. | `gmailService.ts` |
| P4-5 | The cached copy of a sent reply stores plain text as `bodyHtml`. | `DraftService.recordOutboundMessage` |
| P4-6 | Initial bundle ≈527 kB, above the 500 kB warning budget. | Re-measure after `npm ci`. |
| P4-7 | Noisy backend test output (unmocked logger in some suites). | — |
| P4-8 | Local `frontend/node_modules` is Angular 17 while `package.json` is Angular 21. | Environment, not code: `npm ci` in `frontend/`. |

### 5.5 Documentation follow-ups

- `backend/.env.example` says "Required scopes: gmail.modify"; the code requests `gmail.readonly`, `gmail.modify` and `gmail.send` (README is correct).
- Re-run `ng build`, frontend typecheck and Docker on Node 20.19.5 and update section 0 and the README test table.
