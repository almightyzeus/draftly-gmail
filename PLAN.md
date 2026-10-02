# Draftly — Review Findings & Hardening Plan

This replaces the original one-week build plan (its schedule and checklists are complete
or superseded). The plan below comes from a full review of the repository.

**Working rules for every stage:** one stage at a time; inspect the files again before
changing them; add or update tests; run the stage's validation commands; stop for review.
No dependency upgrades and no commits unless explicitly approved.

---

## 1. Current baseline (verified)

| Area | Status |
|---|---|
| Backend tests | 18 files, 253 tests passing; `npx tsc --noEmit` clean |
| Backend coverage | 93.09% statements, 75.6% branches |
| Frontend tests | 3 files, 36 tests passing; app typecheck clean |
| Frontend coverage | 83.83% statements, 67.1% branches (needs Node ≥ 20) |
| Production build | passes; **initial bundle 994.85 kB vs a 1 MB hard error budget** |
| Docker | `docker compose up --build` works; nginx proxies `/api` to the backend |

### Completed work (preserve)

- Signed, expiring Gmail OAuth state; `FRONTEND_URL` redirects; encrypted Gmail tokens; refresh persistence; Google revocation; `invalid_grant` → account marked disconnected.
- JWT access/refresh tokens; `POST /api/auth/refresh`; interceptor refresh-and-retry once.
- RFC `Message-ID` / `In-Reply-To` / `References` threading; Gmail `threadId` preserved.
- Consolidated thread replies (`replyToGmailMessageId`, all unread messages in the prompt).
- Durable send idempotency: atomic claim on the Draft document, `Idempotency-Key` header (body key still accepted).
- Gmail search + pagination (`q`, `pageToken`, `limit`, `label`, `unread`, `nextPageToken`); frontend search UI with a page-token stack.
- Docker fixes: Angular `browser/` output; brute-force limiter only on failed login/register; `TRUST_PROXY=1`; backend port bound to `127.0.0.1`; session restore no longer hits a circular DI error (NG0200).

---

## 2. Review findings

Severity reflects this app's actual deployment: a local, multi-user-capable app behind nginx.
Each finding cites the code it comes from.

### 2.1 Security

| # | Severity | Finding | Evidence |
|---|---|---|---|
| S1 | **Medium** | **Logout does not end the session.** The frontend also writes the access token (15 min) and refresh token (7 days) to JS-readable cookies, and `logout()` only clears `localStorage`. The backend accepts both cookies (`authenticateJWT` cookie fallback, `/auth/refresh` cookie fallback), so after logout anyone using that browser can mint new tokens for 7 days. The cookies exist only so the full-page `/oauth/connect` redirect is authenticated. | `frontend/.../auth.service.ts` `storeTokens`/`setCookie`/`logout`; `backend/src/middleware/auth.ts`; `authController.refresh` |
| S2 | **Medium** | **The OAuth `state` JWT is also a valid API access token.** It is signed with `JWT_ACCESS_SECRET`, carries `userId`, and `authenticateJWT` ignores its `type: 'gmail_oauth'` claim. The state passes through Google's redirect URL, browser history and the backend request log (S8), so anyone who sees it gets a 10-minute API session as that user. | `gmailOAuthService.generateOAuthStateToken`; `middleware/auth.ts` |
| S3 | **Medium** | **The OAuth callback uses a process-wide singleton OAuth2 client.** `handleCallback` calls `oauth2Client.setCredentials(tokens)` on a module-level client, then `getProfile`. Two concurrent callbacks can fetch user A's profile with user B's credentials, saving A's account under B's Gmail address. That address also drives INBOUND/OUTBOUND classification. The last user's tokens also stay in the shared client. | `services/googleClient.ts` (`oauth2Client`); `gmailOAuthService.handleCallback` |
| S4 | **Medium** | **Reply headers are built from untrusted input without CR/LF stripping.** `To:` comes from the inbound `From` header and `Subject:` from the inbound subject; both are concatenated into the raw RFC 822 message. If Gmail returns a decoded header value containing a line break (e.g. an RFC 2047 encoded word), a sender could inject headers such as `Bcc:` into the user's approved reply. *Exploitability against Gmail's API is not verified; the unsafe concatenation is.* The same MIME builder is duplicated in `createDraft` and `updateDraft`, and bodies are sent unencoded (no transfer encoding, unbounded line length). | `gmailService.createDraft` / `updateDraft` |
| S5 | Low | The OAuth `state` is signed but not tied to the browser that started the flow. Another Draftly user could get a victim to complete Google consent with *their* state and link the victim's Gmail to their account. This needs social engineering, a Google consent click, and an account on the same instance. | `gmailOAuthService.verifyOAuthStateToken` |
| S6 | Low | **Direction is detected by substring match:** `from.includes(userEmail)`. `evil-user@gmail.com` matches `user@gmail.com`, so attacker mail can be stored as OUTBOUND and fed to the AI as "my writing style" examples. | `gmailService.getEmailDirection`; `openaiService.fetchLearningEmails` |
| S7 | Low | **Docker runs with `NODE_ENV=development`**, so the global error handler returns stack traces and pino-pretty is used. The backend image runs as root with dev dependencies (`npm install`, no `--omit=dev`). | `backend/.env.docker` (untracked), `app.ts` error handler, `backend/Dockerfile` |
| S8 | Low | **The request log records full URLs**, including the OAuth `code` and `state` on the callback and users' Gmail search queries. | `app.ts` (`morgan('combined')`) |
| S9 | Low | **Email HTML renders inline in the app page.** Angular's sanitizer removes scripts and event handlers (no script XSS found), but remote images or tracking pixels load automatically and links render in the app's context. Plain text uses `bypassSecurityTrustHtml` after manual escaping; that's safe as written but unnecessary. | `email-detail.component.ts/html` |
| S10 | Low | **Non-string body fields reach Mongo filters.** `gmailMessageId` / `threadId` from `POST /drafts/generate` are used in queries untyped, so `{"$ne": null}` acts as an operator. Every query is scoped to `userId`, so there is no cross-user impact. | `draftController.generateDraft` → `draftService` / `gmailService` |
| S11 | Low | **No OpenAI cost or abuse bounds.** `/drafts/generate` has no rate limit, there are no length caps on thread bodies, learning emails, `customContext` or `signature`, and the OpenAI client has no timeout. Prompt injection from email content is mitigated by human approval. | `openaiService.generateDraft`; `preferenceController` |
| S12 | Info | Stateless refresh tokens (not revocable server-side); tokens in `localStorage` (standard SPA trade-off); 6-character minimum password; no minimum strength check on JWT secrets; nginx serves the SPA without CSP or other security headers; MongoDB has no auth (internal Docker network only). | various |

Verified as fine: bcrypt hashing; HS256 pinned on verify; separate access/refresh secrets; every Draft/Email/Log query scoped by `userId`; AES-256-GCM with a random IV and auth tag; CORS locked to `FRONTEND_URL`; Helmet on the API; send idempotency; Gmail search params validated.

### 2.2 Correctness

| # | Severity | Finding | Evidence |
|---|---|---|---|
| C1 | **Medium** | **Editing an APPROVED draft can diverge from what is sent.** If the Gmail draft update fails, the error is logged and the Mongo body is still saved. The UI shows the new text, but Send sends the Gmail draft, which still holds the old text. An edit racing a send can also change the body of a SENT draft (full-document `save()` with no status condition). | `draftService.updateDraft` |
| C2 | **Medium** | **Approve with unsaved edits is racy.** `approveDraft()` calls `saveDraft()` without waiting, then immediately sends approve, so the Gmail draft can be created from the old body. | `draft-detail.component.ts` `approveDraft` |
| C3 | **Medium** | **Not-found and ownership failures return 500.** Services throw plain `Error('Draft not found')`, `Error('Email not found')`, `Error('Gmail account not connected')`, and controllers map non-`AppError`s to 500. A test currently asserts that a cross-user GET returns 500. | `draftService.*`, `gmailService.getEmail`, `getGmailClient`; `integration.test.ts` |
| C4 | Low | An empty OpenAI response is saved as the literal draft body "Failed to generate draft", which could then be approved and sent. | `openaiService.generateDraft` |
| C5 | Low | `internalDate` comes from the sender-controlled `Date` header. An unparseable date makes the cache upsert fail and the message silently disappears from the list. Gmail's own `internalDate` is available. | `gmailService.fetchEmails` |
| C6 | Low | HTML-only emails cache an empty `bodyPlain`, so the AI prompt and the style examples get no content. | `gmailService.parseEmailBody` |
| C7 | Low | The dashboard's `currentUser$` subscription is never unsubscribed (a leak per visit), and the first load can fetch the inbox twice (subscription plus `getMe()`). | `dashboard.component.ts` `ngOnInit` |

### 2.3 Architecture

| # | Problem | Proposed change | Benefit | Risk | Worth it? |
|---|---|---|---|---|---|
| A1 | Six controllers each define the same `handleError`; services mix `AppError` with plain `Error` (see C3). | Services throw `NotFoundError`/`ConflictError`; one shared `sendError(res, err, fallback)` helper. | Correct status codes, one place to change. | Low; tests assert some statuses. | **Yes** |
| A2 | The MIME message builder is duplicated in `createDraft` and `updateDraft` (S4). | A single `buildReplyMessage()` that sanitizes headers and base64-encodes the parts. | Fixes S4 once. | Low; tests on raw output. | **Yes** |
| A3 | Dead code: `GmailService.sendReply` (throws "Not implemented"), `deleteDraft`, the `sendDraft` `inReplyTo`/`references` params (unused), `GmailOAuthService.getValidTokens` plus a second `persistRefreshedTokens`, the singleton `oauth2Client`, `encryptToJson`/`decryptFromJson`, `OpenAIService.generateReply`/`generateConsolidatedReply`/`extractKeyPoints`; frontend `app.component.html`/`.css` (unused CLI welcome page, 476 lines). | Delete. | Less surface and confusion. | Very low. | **Yes** |
| A4 | OpenAI config bypasses `env`: it reads `process.env` directly and defaults to `gpt-4-turbo`, while `env.openai.model` defaults to `gpt-4o-mini` and is unused. | Use `env.openai`; set a timeout and retries. | One source of config. | Very low. | **Yes** |
| A5 | **The initial bundle is 5 kB below the hard 1 MB build error**; every route is eager. Any new Material module (dialog, chips) can break the build. | Lazy-load routes with `loadComponent`. | Large headroom; faster first paint. | Low. | **Yes** (needed before UI work) |
| A6 | Inbox listing fetches messages sequentially (N+1, 21 Gmail calls per page). | Bounded parallel `messages.get` (e.g. 5 at a time). | Noticeably faster inbox. | Low–medium (Gmail quota). | Optional |
| A7 | `zod` and `joi` are installed but unused; validation is hand-written. | Leave the code as is; removing them is a dependency change and needs your approval. | — | — | Leave |
| A8 | Controllers use `try/catch` everywhere, even though Express 5 forwards async errors. | — | Marginal. | Broad churn. | **Leave** |

### 2.4 Frontend / UI

- **Functional gap:** there is no drafts list. After leaving a draft page the only ways back are regenerating or knowing the URL; "Back to Drafts" goes to the dashboard. `DraftService.getDrafts()` exists but nothing uses it.
- **Native `confirm()` dialogs** for send, reject, disconnect and unsaved changes. `MatDialog` is injected into DraftDetail but unused.
- **Inconsistent feedback:** success/error shown as cards on draft and email pages, as `MatSnackBar` on login and register.
- **The draft editor is a raw `<textarea>`** with a hand-made character count and label, unlike every other field, which uses `mat-form-field`.
- **Accessibility:** icon-only buttons (back, account menu) have no accessible name; inbox rows are clickable `<tr>`s with no keyboard access; no `autocomplete` on login/register fields; the dashboard toolbar has no app title.
- **Duplicated styling:** login and register CSS are identical except one `max-width`; `loading-state`, `error-state`, `error-card`, `toolbar`, `content`, `inline-spinner` and `full-width` are redefined in 2–4 page stylesheets; 59 hardcoded colour values across page CSS. Dashboard CSS is 3.69 kB against a 4 kB error budget.
- **Repetition:** `isSaving || isApproving || isRejecting || isSending` appears 7 times in the draft template; the "spinner inside button" block appears 6 times.
- **Responsive:** the 4-column inbox table isn't adapted for narrow screens.
- **No Bootstrap** in the project, so polish uses Angular Material plus shared global styles.

### 2.5 Angular / RxJS

- 18 `subscribe(next, error)` calls use the deprecated two-callback form.
- No lifecycle-safe teardown for long-lived streams (C7); `takeUntilDestroyed()` fits.
- Template calls to `sanitizeHtml()` / `formatPlainText()` run on every change-detection pass.
- Constructor DI everywhere; no signals or `OnPush`. The app is zone-based with mutable component state, which is fine as it is.
- `provideAnimations()` may be removable with Material 21 (a bundle saving), but this needs investigation first and is not recommended blind.

### 2.6 Tests

Backend: good coverage, and the new idempotency/rate-limit tests run against real Mongo. Some test files don't mock the logger, so test output is noisy.
Frontend: tests construct component classes directly, so there are no template, rendering or accessibility assertions. That's acceptable at this size; the UI stage verifies in a real browser.

---

## 3. Staged plan

Priorities: 1 = must-fix security/correctness · 2 = architecture · 3 = UI/UX · 4 = Angular/RxJS · 5 = cleanup.
**Stages 1–3 are recommended. Stage 4 is recommended as scoped (targeted, not a migration). Stage 5 is recommended, with the drafts list needing your decision. Stage 6 is the original final verification and docs stage.**

### Stage 1 — Session & OAuth hardening *(Priority 1: S1, S2, S3, S8)*

- **Objective:** logout really ends the session; OAuth artifacts can't be used as credentials; no shared OAuth client state.
- **Changes:**
  1. Add `GET /api/gmail/oauth/url` (authenticated XHR) returning the consent URL. The frontend fetches it and then navigates, which removes the need for auth cookies.
  2. Remove the cookie fallbacks from `authenticateJWT` and `/auth/refresh`; stop writing token cookies; `logout()` deletes any legacy cookies. Keep `/oauth/connect` working by header only, or remove it once the frontend no longer uses it.
  3. Give the OAuth state token its own audience (`aud: 'gmail-oauth-state'`) and make `authenticateJWT` reject any token carrying that audience or a `type` claim.
  4. `handleCallback` uses a fresh `createOAuth2Client()`; delete the singleton.
  5. Strip query strings from request-log lines for `/api/gmail/oauth/callback` (and `q` on `/emails`).
- **Files:** `backend/src/middleware/auth.ts`, `controllers/authController.ts`, `controllers/gmailController.ts`, `routes/gmailRoutes.ts`, `services/gmailOAuthService.ts`, `services/googleClient.ts`, `app.ts`; `frontend/.../auth.service.ts`, `services/gmail.service.ts`.
- **Tests:**
  - a cookie-only request gets 401;
  - `/refresh` without a body token gets 401;
  - a state token used as Bearer gets 401;
  - a normal access token still works;
  - two concurrent callbacks each save their own Gmail address;
  - the `/oauth/url` response;
  - frontend `connectGmail` and `logout` behaviour.
- **Validation:** backend `npx tsc --noEmit`, `npm test`; frontend `npm test`, typecheck, `ng build`; Docker connect-Gmail redirect check in a browser.
- **Risk:** low–medium. It touches the OAuth entry point. The Google redirect URI is unchanged, and existing sessions keep working via the header.
- **Not included:** S5 (binding state to the browser via an HttpOnly nonce cookie). Recommended to leave and document for a local app; it could be added here if you want it.

### Stage 2 — Draft & send workflow integrity *(Priority 1: C1, C2, S4, S6, C4, C5)*

- **Objective:** what the user approves is exactly what Gmail sends, and reply headers can't be injected.
- **Changes:**
  1. Single `buildReplyMessage()`: strip CR/LF from header values, RFC 2047-encode a non-ASCII subject, base64-encode the plain-text and HTML parts, use a random boundary (fixes A2).
  2. `updateDraft` on an APPROVED draft: if the Gmail sync fails, fail the request without saving (502/409). The update is conditional on status `PENDING|APPROVED` and no active send claim.
  3. Frontend: approve waits for the save (`concat`/`switchMap`) before approving.
  4. Direction: OUTBOUND when Gmail's `SENT` label is present or the parsed `From` address equals the account address exactly.
  5. An empty AI response throws instead of saving placeholder text.
  6. Use Gmail `internalDate` (falling back to the `Date` header, then now).
- **Files:** `backend/src/services/gmailService.ts`, `draftService.ts`, `openaiService.ts`; `frontend/.../draft-detail.component.ts`; tests.
- **Tests:**
  - header injection attempt (`\r\nBcc:`) is neutralised;
  - encoded subject and body round-trip;
  - Gmail sync failure leaves Mongo unchanged;
  - edit is rejected on a SENT or claimed draft;
  - save-then-approve ordering;
  - `evil-user@` stays INBOUND;
  - `SENT` label means OUTBOUND;
  - empty AI response produces an error;
  - invalid `Date` header still caches.
- **Validation:** backend typecheck and full suite; frontend tests and build.
- **Risk:** medium. It changes the raw MIME format, so check one real approve/send in Gmail once Gmail is reconnected.

### Stage 3 — Consistent errors, config & dead code *(Priority 2/5: C3, A1, A3, A4, S7, S10, S11)*

- **Objective:** correct HTTP statuses, one error path, one config source, no dead code.
- **Changes:**
  1. Services throw `NotFoundError` / `ConflictError` / `ValidationError`.
  2. Shared controller error helper.
  3. Controllers require string types for ids and bodies (closes S10).
  4. OpenAI uses `env.openai`, with a timeout and per-message/`customContext`/`signature` length caps.
  5. A light per-user limiter on `/drafts/generate`.
  6. Delete the dead code listed in A3.
  7. `docker-compose.yml` sets `NODE_ENV: production`.
  8. Backend image installs production dependencies only and runs as the non-root `node` user.
- **Files:** backend controllers, services, `app.ts`, `docker-compose.yml`, `backend/Dockerfile`, `utils/errors.ts`; tests (including updating the cross-user test from 500 to 404).
- **Tests:**
  - 404 for a missing or other user's draft and email;
  - 409 for invalid state transitions;
  - 400 for non-string ids;
  - the generate limiter;
  - OpenAI input truncation.
- **Validation:** backend typecheck, `npm test`, `npm run test:coverage`; `docker compose up --build`, then health and login checks.
- **Risk:** low–medium. API status codes change (500 becomes 404/409); the frontend already reads `error.error.error`.

### Stage 4 — Frontend structure & targeted modernization *(Priority 2/4: A5, C7, S9, §2.5)*

- **Objective:** build headroom and lifecycle-safe RxJS. This is not a migration.
- **Changes:**
  1. Lazy-load routes (`loadComponent`).
  2. Replace the deprecated `subscribe(next, error)` calls with observer objects.
  3. `takeUntilDestroyed()` for the dashboard's user stream; a single initial inbox fetch.
  4. DraftDetail: busy flags as signals with a `computed` `isBusy` (removes the 7× repeated expression). Other components stay as they are unless a signal clearly simplifies them.
  5. Render plain-text email with `white-space: pre-wrap` and interpolation (drops `bypassSecurityTrustHtml`); compute sanitized HTML once per load instead of per change-detection pass.
  6. Delete the unused `app.component.html` / `.css`.
- **Files:** `app.routes.ts`, all page components, `auth.service.ts`; tests.
- **Tests:** update component tests for observer callbacks and signals; dashboard teardown test; single initial fetch; email plain-text rendering.
- **Validation:** frontend `npm test`, coverage, `ng build` (record the new initial bundle size), browser smoke test of every route.
- **Risk:** low.

### Stage 5 — UI/UX polish (Material-first, same visual identity) *(Priority 3: §2.4)*

- **Objective:** a consistent, accessible, responsive UI without a redesign.
- **Changes:**
  1. One reusable `ConfirmDialogComponent` (MatDialog) replacing `confirm()`.
  2. Draft editor as `mat-form-field` `textarea` with a `mat-hint` character count.
  3. Transient success via `MatSnackBar` everywhere; inline error states remain for load failures.
  4. Shared global styles for auth pages, page toolbar/content, loading/error/empty states, and button spinners; remove duplicated page CSS; replace hardcoded colours with theme colours or a few CSS variables.
  5. Accessibility: `aria-label`s on icon buttons; keyboard-activatable inbox rows (`tabindex`, Enter/Space); `autocomplete` attributes; app title in the toolbar.
  6. Responsive table: hide the preview/date columns on narrow screens.
  7. **Minimal drafts list** (decision needed): a "Drafts" card on the dashboard using the existing `MatTable` and `GET /api/drafts`, filtered by status. Recommended, because without it drafts are unreachable.
- **Files:** page templates/CSS, `styles.css`, a new `shared/confirm-dialog.component.ts`, `dashboard.component.*`; tests.
- **Tests:** dialog confirm and cancel paths; drafts list loading/empty/error states; keyboard activation on rows.
- **Validation:** frontend tests and build (CSS budgets); headless-browser check of each page at desktop and phone widths, with screenshots for review.
- **Risk:** low–medium, since it's visual. Done page by page.

### Stage 6 — Final verification & documentation *(the original Stage 6, still pending)*

- **Objective:** confirm everything end to end and make the docs match reality.
- **Steps:**
  1. Backend: `npx tsc --noEmit`, `npm test`, `npm run test:coverage`.
  2. Frontend: `npm test`, `npm run test:coverage`, `npm run build`. Use Node ≥ 20; the default Node 18 can't run these.
  3. `docker compose up --build`; confirm `mongodb://mongodb:27017/draftly` inside Docker; confirm nginx proxies `/api`.
  4. README: search, pagination, idempotent sending and `Idempotency-Key`, current API behaviour and status codes, actual test and coverage numbers, Angular 21 stack, Docker usage (`TRUST_PROXY`, loopback port, OAuth redirect URI), Node 20 requirement, the "Testing" OAuth app 7-day refresh-token caveat.
- **Risk:** none (verification and docs only).

---

## 4. Recommended to leave alone

- **Adopting `zod`/`joi`** or other validation-framework rewrites: hand validation is adequate. Removing the unused packages is a dependency change and would need your approval.
- **Express 5 async-handler refactor:** broad churn for little gain (A8).
- **A full signals or `OnPush` conversion** of services and components: not needed for a zone-based app this size.
- **Server-side refresh-token revocation store:** extra state and complexity; logout correctness comes from Stage 1.
- **Sandboxed-iframe email rendering:** script XSS is already mitigated; document the remote-image behaviour (S9) instead.
- **Removing `provideAnimations()`:** possible bundle win, but only after checking Material 21's needs.
- **Gmail N+1 parallelisation (A6):** optional; do it only if inbox latency matters for the demo.
- **OAuth state browser binding (S5):** low risk for a local app; document it.
