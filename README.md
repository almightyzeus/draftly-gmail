# Draftly: Gmail AI Reply Agent

Draftly is a self-hosted web app that connects to Gmail, lists and searches inbox emails, generates AI reply drafts, lets the user review/edit/approve/reject drafts, and sends approved replies through Gmail.

The full workflow is implemented and tested, and the app runs with Docker Compose. It is built for a single-machine setup; the steps still needed for a public production deployment are listed under [Known Limitations](#known-limitations).

## Why Draftly

Professionals spend time writing routine replies such as acknowledgements, follow-ups, confirmations, and meeting responses. Draftly automates the first draft while keeping the user in control before anything is sent.

The system supports:

- Gmail OAuth2 connection
- Listing, searching (Gmail query syntax), and paging through inbox emails, with sender, subject, body, timestamp, and thread ID
- AI-generated reply drafts with tone options
- One consolidated reply for all unread messages in a thread, using the full thread as context
- User style examples from previous outbound emails
- Draft review, edit, approval, rejection, and sending — nothing is sent without explicit approval
- Idempotent sending: a draft is sent through Gmail at most once, even with retries or double clicks
- Storage of users, Gmail accounts, emails, drafts, preferences, and activity logs
- Encrypted Gmail token storage

## Tech Stack

- Backend: Node.js 24, Express 5, TypeScript
- Database: MongoDB with Mongoose
- Frontend: Angular 22 (standalone components, lazy-loaded routes) with Angular Material 22 and Tailwind CSS 4 for layout utilities, TypeScript 6.0
- AI: OpenAI API
- Gmail: Google OAuth2 and Gmail API
- Auth: JWT access + refresh tokens
- Security: bcrypt password hashing, AES-256-GCM token encryption, Helmet, CORS, rate limiting, nginx Content-Security-Policy and security headers
- Tests: Vitest (backend and frontend), Supertest, mongodb-memory-server

## Features

- Gmail OAuth2 integration with signed, expiring OAuth state
- Gmail search and pagination backed by Gmail itself (not a local copy)
- AI-generated email reply drafts with formal / concise / friendly tones
- Human-in-the-loop approval workflow, with Gmail drafts created on approval
- Thread-aware, consolidated replies
- Personalized writing style learning
- Idempotent, concurrency-safe sending
- Dockerized local deployment with Docker Compose

## Architecture Overview

- Angular frontend served through an nginx container
- nginx reverse proxy forwards `/api` requests to the backend container
- Express backend exposes REST APIs and integrates with Gmail/OpenAI
- Gmail is the source of truth for the inbox: listing and search call the Gmail API; MongoDB caches the messages that were listed, plus whole threads fetched when a draft is generated (needed for thread context, drafting, and reply headers)
- MongoDB stores users, Gmail accounts (encrypted tokens), cached emails, drafts and their send state, preferences, and activity logs
- Docker Compose orchestrates frontend, backend, and MongoDB services locally

## Implemented Features

Backend:

- Registration, login, JWT-protected routes, and token refresh (`POST /api/auth/refresh`)
- Gmail OAuth connect, callback, and revoke (revoke calls Google's revocation endpoint); refreshed Google tokens are persisted; an expired or revoked Google grant marks Gmail as disconnected so the UI can prompt to reconnect
- Inbox listing with Gmail search (`q`), `label`, `unread`, `limit`, and Gmail page tokens (messages are fetched from Gmail in parallel, 10 at a time)
- AI draft generation using tone, thread context, signature, custom context, and recent outbound style examples
- Draft list/detail/update/approve/reject/send APIs; each draft response includes exactly who the reply goes to (`recipients`)
- Replies go to the `Reply-To` address when the original email has one; optional reply all copies the email's other recipients
- Gmail draft creation on approval; edits to an approved draft are synced to Gmail before they are saved
- Replies use the original message's RFC `Message-ID` for `In-Reply-To`/`References` and keep Gmail's `threadId`
- Preferences and activity log APIs

Frontend:

- Login and register
- Top bar with Gmail connection status (connect / disconnect) and account menu
- Dashboard with an **Inbox** tab (search, unread filter, pagination) and a **Drafts** tab (filter by status)
- Email detail with AI draft generation
- Draft detail with editing, To/Cc recipients, a **Reply all** switch, approve, reject, and send (with confirmation dialogs)
- Preferences page (account menu → **Preferences**): default tone, signature, and number of style examples
- Activity page (account menu → **Activity**): drafts generated, edited, approved, rejected, replaced and sent, newest first, with a filter by action, paging, and links to each draft

## Project Structure

```text
backend/
  src/
    app.ts              # Express app: security middleware, routes, error handling
    server.ts           # Startup and graceful shutdown
    config/env.ts       # Validated environment configuration
    controllers/        # HTTP layer: input validation, status codes
    middleware/auth.ts  # Bearer JWT authentication
    models/             # Mongoose models
    routes/
    services/           # Business logic: Gmail, OAuth, drafts, OpenAI, auth
    utils/              # errors, logger, crypto, MIME building, URL redaction, concurrency
  tests/

frontend/
  nginx.conf
  src/
    theme.scss          # Angular Material theme (indigo/pink, Material 2 look) and its --mat-sys-* colour variables
    styles.css          # Global design tokens and shared layout/state styles
    tailwind.css        # Tailwind utilities (no base reset), colours mapped to the theme
    app/
      pages/            # Lazy-loaded pages
      services/         # API clients, auth interceptor and guard
      shared/           # Top bar, confirm dialog, formatting helpers
  tests/

docker-compose.yml
```

## Prerequisites

- Node.js 24 LTS (`.nvmrc` holds `24`, so `nvm use`, CI and the `node:24-alpine` Docker images all take the latest Node 24 release). Node 20 reached end-of-life in April 2026; Angular 22 needs Node ≥ 24.15.0 on the 24 line (or ≥ 22.22.3).
- Google Cloud OAuth2 credentials with the Gmail API enabled
- Docker Desktop / Docker Engine with Docker Compose
- OpenAI API key

## Docker Setup

The recommended way to run Draftly locally is with Docker Compose. The stack includes:

- Angular frontend served through nginx
- Express backend API
- MongoDB database
- nginx reverse proxying for `/api` requests

### Environment Setup

1. Copy the example environment file:

```bash
cp backend/.env.example backend/.env.docker
```

2. Update the MongoDB connection string inside `backend/.env.docker`:

```env
MONGODB_URI=mongodb://mongodb:27017/draftly
```

3. Fill in the secrets and keys (see [Local Development Setup](#local-development-setup) for how to generate them). The backend refuses to start while `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are still the `.env.example` placeholders, shorter than 32 characters, or identical.

`docker-compose.yml` additionally sets, for the backend container:

- `NODE_ENV=production` — JSON logs and no stack traces in error responses
- `TRUST_PROXY=1` — nginx is the single proxy hop, so rate limits see the real client IP

### Start the Full Stack

From the project root:

```bash
docker compose up --build
```

Note: Some Linux environments may require using `docker-compose` instead of `docker compose`.

```bash
docker-compose up --build
```

### Services

| Service | Address | Notes |
|---|---|---|
| Frontend (and API via `/api`) | http://localhost:4200 | Use this in the browser |
| Backend API | http://127.0.0.1:3000 | Bound to localhost only; needed for the Google OAuth callback |
| MongoDB | `mongodb://mongodb:27017/draftly` | Internal to the Docker network; not published to the host |

### Stop the Stack

```bash
docker compose down
```

### Notes

- MongoDB data is persisted using a Docker volume (`mongo-data`).
- Frontend API calls use `/api` routes through nginx reverse proxying.
- The backend image is built in two stages and runs as the non-root `node` user with production dependencies only.
- On a machine with limited memory, avoid running two `docker compose ... --build` commands at the same time; the Angular build inside the image can stall.
- The setup targets a single machine, not a production-scale cloud deployment.

## Local Development Setup

Create `backend/.env`:

```env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:4200

MONGODB_URI=mongodb://localhost:27017/draftly

# At least 32 characters each and different from each other (the backend refuses to start otherwise)
JWT_ACCESS_SECRET=replace-with-openssl-rand-base64-32-output
JWT_REFRESH_SECRET=replace-with-a-different-openssl-rand-base64-32-output
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

DATA_ENCRYPTION_KEY_BASE64=replace-with-base64-encoded-32-byte-key

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/oauth/callback

OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini

# Optional: number of reverse-proxy hops to trust (leave unset when not behind a proxy)
# TRUST_PROXY=1

# Optional: log level (default: info in production, debug in development, silent in tests)
# LOG_LEVEL=debug
```

To generate the encryption key and JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Install and run the backend:

```bash
cd backend
npm install
npm run dev
```

Health check:

```http
GET http://localhost:3000/health
```

## Frontend Setup

```bash
cd frontend
npm install
npm start
```

Open:

```text
http://localhost:4200
```

The Angular dev server proxies `/api` requests to `http://localhost:3000`.

In Docker Compose, nginx reverse proxying is used so frontend API calls work with the same `/api` routes without frontend code changes.

## Gmail OAuth Setup

In Google Cloud Console:

1. Create or select a project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen. While the app is in **Testing** mode, add your Google account as a test user.
4. Create OAuth 2.0 credentials (Web application).
5. Add this redirect URI:

```text
http://localhost:3000/api/gmail/oauth/callback
```

The backend requests the Gmail read, modify, and send scopes.

Note: for apps in **Testing** mode, Google expires refresh tokens after 7 days. When that happens, Draftly marks Gmail as disconnected and the UI shows **Connect Gmail** — just reconnect. Publishing the app removes this limit.

How the connect flow works: the frontend calls `GET /api/gmail/oauth/url` with its Bearer token, then navigates to the returned Google URL. The `state` parameter is a signed, 10-minute token with its own audience, so it cannot be used as an API token.

Google then redirects the browser to the callback, which always redirects back to the app: to `/dashboard` on success, or to `/dashboard?gmailError=<code>` on failure. The dashboard shows a message for the code (and removes it from the URL). Codes: `access_denied` (consent cancelled or denied), `missing_code`, `state_expired`, `state_invalid`, `connection_failed`. Only these fixed codes travel in the URL, never error text. If the session ended meanwhile, login returns the user to that page.

## Demo Flow

1. Run `docker compose up --build`.
2. Open `http://localhost:4200`.
3. Register or log in.
4. Click **Connect Gmail** (top bar) and complete Google OAuth.
   Optionally, open **Preferences** from the account menu to set your default tone, signature, and number of style examples.
5. Back on the dashboard, browse the **Inbox**: search with Gmail syntax (e.g. `from:alice subject:"report"`), toggle **Unread only**, and use **Next**/**Previous**.
6. Open an email.
7. Choose a tone, optionally add context, and click **Generate draft**. Generating again with another tone or new context replaces the pending draft.
8. Review the draft — the header shows who it will be sent to — and edit it if needed.
9. Approve the draft. This creates a Gmail draft.
10. Send the approved draft (you confirm the recipient first).
11. Find all drafts and their status in the **Drafts** tab.

## REST API

All protected endpoints require:

```http
Authorization: Bearer <accessToken>
```

Errors are JSON: `{ "error": "message" }`.

### Status codes

| Status | Meaning |
|---|---|
| 400 | Invalid input (wrong type, too long, malformed JSON, invalid search/page token) |
| 401 | Missing, invalid, or expired token (the frontend refreshes once and retries) |
| 403 | Gmail access expired or was revoked (detected on any Gmail call: listing, approve, edit, send, reject) — Gmail is marked disconnected; reconnect |
| 404 | Not found, including another user's draft or email, or a malformed id |
| 409 | Invalid state: e.g. approving a non-pending draft, editing/sending a sent draft, a send already in progress, Gmail not connected, or a reply that would go to your own address |
| 413 | Request body too large |
| 422 | Nothing valid to reply to (e.g. a thread with no message from someone else) |
| 429 | Rate limit (failed logins, draft generation, or Gmail on any call, after retries) |
| 502 | An upstream step failed: the Gmail draft could not be updated (edit not saved) or the AI returned an empty draft |
| 503 | Gmail is temporarily unavailable (server or network errors that persisted through retries) |

### Auth

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh      # body: { "refreshToken": "..." }
GET  /api/auth/me
```

Register body:

```json
{
  "name": "Test User",
  "email": "test@example.com",
  "password": "password123"
}
```

Login body:

```json
{
  "email": "test@example.com",
  "password": "password123"
}
```

New passwords must be at least 8 characters and at most 72 bytes (bcrypt ignores anything longer); login does not re-check length, so older accounts keep working.

Login and register allow 5 **failed** attempts per 15 minutes per client IP; successful requests are not counted. Tokens are accepted only in the `Authorization` header (never from cookies).

#### Sessions, logout and the two kinds of tokens

Draftly handles two unrelated sets of tokens:

| | Draftly session (JWT) | Google OAuth (Gmail access) |
|---|---|---|
| Issued by | Draftly at login/register | Google when the user connects Gmail |
| Stored | Browser `localStorage` (access + refresh token) | MongoDB, encrypted (AES-256-GCM) |
| Lifetime | Access 15 min, refresh 7 days (configurable) | Until revoked (7 days for Google apps in **Testing** mode) |
| Ended by | **Log out** clears both tokens in the browser only | **Disconnect Gmail** calls Google's revocation endpoint and marks the account revoked |

- `POST /api/auth/refresh` verifies the refresh token and that the user still exists, then returns a new access token **and a new 7-day refresh token**. The old refresh token is not invalidated: nothing is stored server-side.
- There is no logout endpoint. Logging out clears the tokens in this browser; a refresh token copied before logout keeps working and can be exchanged for new ones indefinitely. It only stops working if `JWT_REFRESH_SECRET` is changed (which ends every session) or the user is deleted.
- Logging out does not disconnect Gmail: the Google tokens stay stored, so the next login sees Gmail as connected. Disconnecting Gmail revokes the Google grant but does not end the Draftly session.
- When an access token expires, the frontend refreshes once and retries the request; if refreshing fails, it logs out and returns to the login page.

### Gmail

```http
GET  /api/gmail/oauth/url        # returns { "url": "https://accounts.google.com/..." }
GET  /api/gmail/oauth/callback?code=...&state=...   # called by Google
POST /api/gmail/oauth/revoke
GET  /api/gmail/emails
GET  /api/gmail/emails/:gmailMessageId
```

`GET /api/gmail/emails` query parameters:

| Parameter | Description |
|---|---|
| `q` | Gmail search syntax, e.g. `from:alice@example.com`, `subject:"quarterly report"`, or plain text (max 500 chars) |
| `pageToken` | The `nextPageToken` from the previous response (opaque; pass it back unchanged) |
| `limit` | Page size, 1–100 (default 20) |
| `label` | Gmail label (default `INBOX`) |
| `unread` | `true` to show only unread messages |

Response:

```json
{
  "emails": [{ "gmailMessageId": "...", "threadId": "...", "from": "...", "subject": "...", "snippet": "...", "internalDate": "...", "labels": ["INBOX", "UNREAD"] }],
  "nextPageToken": "opaque-token-or-null"
}
```

Without `q`, the default inbox view also hides promotions, social, purchases and no-reply mail; an explicit search behaves like Gmail search.

### Drafts

```http
POST /api/drafts/generate
GET  /api/drafts?status=PENDING&limit=50
GET  /api/drafts/:id
PUT  /api/drafts/:id
POST /api/drafts/:id/approve
POST /api/drafts/:id/reject
POST /api/drafts/:id/send
```

Generate draft body (send `threadId` for a consolidated reply, or `gmailMessageId` for one message):

```json
{
  "threadId": "gmail-thread-id",
  "tone": "formal",
  "customContext": "Optional extra context (max 2000 chars)"
}
```

`tone` is optional (`formal`, `concise` or `friendly`). Without it, the user's `defaultTone` preference is used (`formal` if none is stored), and the email page preselects that tone.

Before generating, the backend fetches the whole thread from Gmail (`threads.get`, newest 50 messages) and caches it, so the reply target and the AI's context include messages that never appeared in an inbox listing (archived messages, your own replies) and current unread state. If Gmail cannot be reached (not connected, access revoked, rate-limited or unavailable), generation uses the cached messages.

The reply always targets a message from someone else: the unread incoming messages in the thread, or otherwise the latest incoming message — never your own messages. Generation is limited to 10 requests per minute per user.

A thread has at most one `PENDING` draft, enforced by a partial unique index (`one_pending_draft_per_thread`), so this also holds when generations run at the same time:

- The same request again (same tone, no `customContext`, e.g. a double click) returns the existing pending draft without calling OpenAI.
- A different tone, or any `customContext`, generates a new draft. The previous pending draft is then marked `REJECTED` (audit action `SUPERSEDED`; it stays in the drafts list) and the new one is saved. If generation or the save fails, the previous draft is kept (restored to `PENDING`).
- If another generation for the thread saves its draft first, the slower request returns that draft when it matches (same tone, no `customContext`), and otherwise replaces it. After three such collisions it returns 409.
- At startup, the backend retires duplicate pending drafts left from before the index existed (keeping the newest per thread), then builds the index.

Update the draft body (max 50,000 chars) and/or reply all; send at least one field:

```json
{
  "draftBody": "Updated draft text",
  "replyAll": true
}
```

For an approved draft, the Gmail draft is updated first (body and recipients); if that fails, the edit is not saved and the API returns 502 (or 403 / 429 if Gmail access expired or Gmail is rate limiting).

Reject works for `PENDING` drafts and for `APPROVED` drafts that are not being sent; for an approved draft, its Gmail draft is also deleted (best effort — if that fails, the draft is still rejected and the failure is logged).

Every draft response includes (all `null`/`false` if the original email is not cached):

- `replyTo: { "from": "...", "subject": "..." }`: the sender and subject of the email being answered.
- `recipients: { "to": [...], "cc": [...] }`: exactly who the reply goes to. `to` is the original email's `Reply-To` mailboxes if it has that header, otherwise its sender (one mailbox). With `replyAll`, `cc` holds the email's other recipients (its To and Cc, plus the sender when `Reply-To` redirected the reply). Your own address and duplicates are removed; at most 50 recipients.
- `replyAll` (default `false`) and `canReplyAll` (whether reply all would copy anyone).

Approve refuses a reply whose only address is your own (409) and an email without a valid address to reply to (422). Recipients come from the incoming email's headers, so the draft page shows To and Cc before you approve or send.

#### Idempotent sending

Send requires an idempotency key, preferably in the standard header:

```http
POST /api/drafts/:id/send
Idempotency-Key: 6f1c2a7e-...
```

The legacy body field `{ "idempotencyKey": "..." }` is still accepted. Keys are 1–255 characters.

How it behaves:

- The first request atomically claims the draft in MongoDB, then calls Gmail, then records the result and marks the draft `SENT`.
- Repeating a request with the **same key** after success returns the stored result without calling Gmail again.
- **Concurrent** requests (same or different keys) cannot both reach Gmail: one wins the claim, the others get 409.
- A **different key** cannot re-send a `SENT` draft (409), and other users' drafts return 404.
- The frontend generates one key per send attempt and reuses it on retry.

Limit: this is a durable claim plus a stored result, not perfect exactly-once delivery. If the backend crashes after Gmail accepts the message but before MongoDB records it:

- The message is **never sent twice**: a later attempt re-sends the same Gmail draft id, which Gmail rejects because sent drafts are deleted.
- For 5 minutes the stranded claim blocks the draft: send, edit and reject return 409.
- After 5 minutes any send attempt takes over the claim; Gmail rejects the used draft id, the claim is released and the API returns a generic 500. The draft stays `APPROVED` even though the email was delivered (check Gmail's Sent folder); it can then be rejected.

Gmail failures during the send call itself are not retried (see Design Notes), for the same reason.

### Preferences

```http
GET /api/preferences
PUT /api/preferences
```

Update preferences body:

```json
{
  "defaultTone": "friendly",
  "signature": "Regards,\nYour Name",
  "learningEmailCount": 5
}
```

`signature` is at most 1000 characters; `learningEmailCount` is an integer from 1 to 20. `defaultTone` is used whenever a draft is generated without a tone. Fields left out keep their current value.

Both endpoints return `{ "defaultTone", "signature", "learningEmailCount" }`. A user without stored preferences gets the defaults (`formal`, empty signature, 5 examples), which are created on first access.

### Logs

```http
GET /api/logs?limit=100&skip=0&action=DRAFT_SENT
GET /api/logs/:entityType/:entityId
```

`action` is optional: one of `DRAFT_GENERATED`, `DRAFT_EDITED`, `DRAFT_APPROVED`, `DRAFT_REJECTED`, `DRAFT_SUPERSEDED`, `DRAFT_SENT` (anything else returns 400). `limit` is 1–200 (default 100).

Both return `{ "logs": [...], "total": <number> }`, newest first. `total` counts all matching logs, not just the returned page.

## Data Models

Main collections:

- `User`
- `GmailAccount` — Gmail access and refresh tokens are encrypted (AES-256-GCM) before storage
- `UserPreference`
- `EmailMessage` — cached Gmail messages, including the RFC `Message-ID` and `References` used for replies
- `Draft` — status, Gmail draft id, reply target, and send claim/result for idempotent sending
- `ActivityLog`

## Scripts

Backend:

```bash
cd backend
npm run dev
npm run build
npm test
npm run test:coverage
npm run test:ci        # coverage run for CI (test files run one at a time)
npm run typecheck:tests   # type-check the test suites (Vitest itself does not)
```

CI: `.github/workflows/ci.yml` runs on every push to `master` and every pull request. The backend job runs `npm ci`, `npx tsc --noEmit`, `npm run typecheck:tests` and `npm run test:ci`; the frontend job runs `npm ci`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run typecheck:tests`, `npm run test:coverage` and `npm run build`. Both use the Node version in `.nvmrc`, fail if the coverage thresholds are not met, and upload their coverage reports. The backend job sets placeholder values for the required environment variables (no secrets are needed: the tests use an in-memory MongoDB and mocks).

GitHub-hosted runs (checked 2026-11-05 via the GitHub API): 12 runs, the first on 2026-11-03. The latest run, on `7dd415b` (2026-11-04, the current `master`), passed both jobs. One run failed: `9f33ab8` (2026-11-03, the `cookie-parser` removal), at the backend `npm ci` step while CI still ran Node 20 / npm 10; every run since the move to Node 24 (`06577ce`) has passed. Before the first hosted run, the workflow's steps were also simulated locally in a clean checkout; that simulation is not a substitute for the hosted results above.

Frontend:

```bash
cd frontend
npm start
npm run build
npm test
npm run test:coverage
npm run typecheck:tests   # type-check the Vitest suites (Vitest itself does not)
```

## Testing Status

Backend tests cover services, controllers, middleware, models, and API workflows against an in-memory MongoDB — including send idempotency under concurrency, OAuth hardening, rate limits, cross-user access, and reply-header injection attempts. Frontend tests cover services, the auth interceptor, and page/component behaviour (search and pagination, drafts, dialogs, error states).

Last verified locally on 2026-11-05 (Node 24.15.0, Windows), re-running every check below; the frontend checks were re-run on 2026-11-11 after the Angular 22 upgrade:

| | Test files | Tests | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|---|
| Backend | 25 | 455 passing | 93.83% | 82.69% | 96.27% | 94.36% |
| Frontend | 9 | 160 passing | 96.23% | 84.63% | 96.56% | 96.66% |

Both typechecks (app and tests) are clean on both sides, and the backend and frontend production builds pass. GitHub-hosted CI (Linux, Node 24 from `.nvmrc`) last passed on 2026-11-04 (see [Scripts](#scripts)).

Node versions: tests and builds were run locally on Node 24.15.0; the Docker images use `node:24-alpine`, which was Node 24.22.2 when both images were last built (2026-11-11, after the Angular 22 upgrade). The stack was then started and checked through nginx: app and SPA routes load with the security headers, and API calls without a token return 401.

`npm audit`: backend **0** vulnerabilities (2026-11-05); frontend **0** (2026-11-11, after the Angular 22 upgrade removed the 16 moderate findings in the CLI's packaging libraries).

Backend coverage is measured by Vitest 5's V8 provider, which counts statements and branches more strictly than the Vitest 1 provider used before 2026-11-04 (then 96.41% statements, 87.60% branches); the tests and covered files are the same.

Backend suites that use MongoDB start an in-memory server through `tests/helpers/mongoMemory.ts` with a 60-second launch timeout (mongod's 10-second default caused random "Instance failed to start" failures on slower machines).

Validation before a demo:

```bash
nvm use
cd backend && npx tsc --noEmit && npm run typecheck:tests && npm run test:coverage
cd frontend && npm run typecheck:tests && npm run test:coverage && npm run build
docker compose up --build
```

`npm run build` passes without warnings: the initial bundle is ≈477 kB (≈110 kB transferred), under Angular's 500 kB warning budget (hard limit 1 MB). Pages are lazy-loaded, and `@angular/animations` is not loaded (Angular Material animates with CSS).

Backend logs are silent during tests (`NODE_ENV=test`), so the failure paths tests exercise on purpose print nothing. Run `LOG_LEVEL=debug npm test` to see them.

## Design Notes

- The backend separates routes, controllers (validation and status codes), services (business logic), models, middleware, and config. Services throw typed errors; one shared helper turns them into responses.
- Drafts use explicit statuses: `PENDING`, `APPROVED`, `REJECTED`, and `SENT`. Sending is only allowed after approval.
- Approval creates a Gmail draft, so the user can also inspect it in Gmail before sending. Unsaved edits are saved (and synced to Gmail) before approve or send, so what is sent is what is on screen.
- Gmail calls retry transient failures (`gmailCall` in `GmailService`, `utils/retry.ts`): 3 attempts with exponential backoff and jitter (0.5 s, then 1 s), honouring `Retry-After` up to 4 s. Rate limits (429, or 403 `rateLimitExceeded`/`userRateLimitExceeded`) are retried for every call; server errors (408/5xx) and network errors only for calls that are safe to repeat (reads, draft update and delete). Creating or sending a draft is never repeated after such a failure, because Gmail may already have done it. The googleapis client's own retry is turned off so attempts never multiply.
- Reply messages are built in one place: header values are stripped of line breaks, address lists are parsed into single mailboxes (only the first mailbox of `From`; `Reply-To`, `To` and `Cc` split safely, at most 50 recipients), non-ASCII names and subjects are encoded, and bodies are base64-encoded.
- A reply is never addressed to the user: reply targets are always messages from someone else, the user's own address is removed from To/Cc, and approve/send refuse a draft whose only recipient is the user.
- User style learning retrieves recent outbound emails and includes them (truncated) as examples in the OpenAI prompt.
- The AI always gets readable text: for HTML-only emails, plain text is derived from the HTML (markup, styles and scripts removed).
- Remote images in emails (often tracking pixels) are hidden until the user chooses **Show images**, so opening an email does not reveal that it was read.
- The app keeps the human-in-the-loop requirement by never sending generated text automatically.
- While an action runs (sign in, register, generate, save, approve, reject, send, reply all, save preferences), a full-page overlay names the action ("Sending reply…") and blocks the page, top bar included. It appears only if the action takes longer than 300 ms and then stays at least 400 ms, so quick actions do not flash. Generating a draft is always slow, so its overlay appears at once and, after 4 seconds, says it is still working; it traps keyboard focus and is announced to screen readers.
- Request logs redact OAuth codes, OAuth state, and search queries, and end with the response time (e.g. `… "curl/8.6.0" 28.558 ms`).
- Security hardening added on 2026-11-04: the nginx headers and the JWT-secret check (next two items), and the password policy for new accounts (see [Auth](#auth)). The headers were checked with curl on the rebuilt frontend image; a browser-console check for CSP violations has not been recorded.
- nginx serves the app with a Content-Security-Policy (`script-src 'self'`, no inline scripts; `style-src` allows inline styles because Angular injects component styles; images from any `https:` host for emails after **Show images**; `frame-ancestors 'none'`) plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`. Critical-CSS inlining is off in the production build because its `onload` handler would violate the CSP. No HSTS header: the Docker setup serves plain HTTP.
- Caching: `index.html` (also served for every app route) is sent with `Cache-Control: no-cache`, so browsers pick up a new release on the next load; the hashed build files (`main-…js`, `chunk-…js`, `styles-…css`) are cached for a year (`immutable`), since every build gives them new names. A missing hashed file returns 404 instead of the app page.
- The backend refuses to start with JWT secrets shorter than 32 characters, left at the `.env.example` placeholder, or identical for access and refresh tokens.

## Known Limitations

Accepted for the current single-machine setup:

- Sending is idempotent but not exactly-once; after a crash mid-send the draft can stay `APPROVED` although the email was delivered (see [Idempotent sending](#idempotent-sending)).
- Emails cached before reply all existed have no stored Cc/Reply-To; generating a draft re-fetches the thread, which fills them in.
- Thread context covers the newest 50 messages of a thread (the prompt uses the latest 20). When Gmail cannot be reached during generation, only cached messages are used.
- Email HTML is sanitized and shown inline (not in a sandboxed iframe). Remote images are hidden until the user clicks **Show images**.
- The OAuth `state` is signed and expiring but not tied to the browser that started the flow.
- Google apps in **Testing** mode expire Gmail refresh tokens after 7 days; the user reconnects.
- The Drafts tab shows the latest 50 drafts. Only draft actions are recorded in the activity log (not logins or Gmail connect/disconnect).

Required before a production deployment (not done):

- **Sessions:** server-side refresh-token storage and revocation (a logout endpoint, rotation that invalidates the old token), and tokens out of `localStorage` (e.g. `HttpOnly` cookies with CSRF protection). Today a copied refresh token can be renewed indefinitely (see [Sessions](#sessions-logout-and-the-two-kinds-of-tokens)).
- **HTTPS** termination and an HSTS header (the Docker setup serves plain HTTP), with the OAuth redirect URI and `FRONTEND_URL` on HTTPS.
- **MongoDB** authentication and TLS, backups (it currently runs without authentication on the internal Docker network).
- **Secrets** from a secrets manager instead of `.env` files; a published (verified) Google OAuth app.
- **Rate limits** in a shared store (they are kept in memory per backend process, so they reset on restart and do not work across several instances).
- Monitoring, log shipping, and an automated deployment (CI only tests and builds).

## Future Improvements

- Cloud deployment (AWS/GCP/Azure) with the production requirements above
- Automated deployment (CI already runs tests and the build)
- Angular 22 upgrade (clears the remaining CLI audit findings)
- Recovering a send interrupted by a crash (mark the draft `SENT` when Gmail shows the message was sent)
