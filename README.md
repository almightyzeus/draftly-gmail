# Draftly: Gmail AI Reply Agent

Draftly is a local MVP for the Airtribe Backend Engineering Launchpad capstone. It connects to Gmail, lists and searches inbox emails, generates AI reply drafts, lets the user review/edit/approve/reject drafts, and sends approved replies through Gmail.

The project is intentionally scoped as an MVP. The core workflow is implemented, containerized with Docker, and demoable locally using Docker Compose.

## Capstone Objective

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

- Backend: Node.js 20, Express 5, TypeScript
- Database: MongoDB with Mongoose
- Frontend: Angular 21 (standalone components, lazy-loaded routes) with Angular Material 21
- AI: OpenAI API
- Gmail: Google OAuth2 and Gmail API
- Auth: JWT access + refresh tokens
- Security: bcrypt password hashing, AES-256-GCM token encryption, Helmet, CORS, rate limiting
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
- Gmail is the source of truth for the inbox: listing and search call the Gmail API; MongoDB caches the messages that were listed (needed for thread context, drafting, and reply headers)
- MongoDB stores users, Gmail accounts (encrypted tokens), cached emails, drafts and their send state, preferences, and activity logs
- Docker Compose orchestrates frontend, backend, and MongoDB services locally

## Implemented Features

Backend:

- Registration, login, JWT-protected routes, and token refresh (`POST /api/auth/refresh`)
- Gmail OAuth connect, callback, and revoke; refreshed Google tokens are persisted; an expired or revoked Google grant marks Gmail as disconnected so the UI can prompt to reconnect
- Inbox listing with Gmail search (`q`), `label`, `unread`, `limit`, and Gmail page tokens (messages are fetched from Gmail in parallel, 10 at a time)
- AI draft generation using tone, thread context, signature, custom context, and recent outbound style examples
- Draft list/detail/update/approve/reject/send APIs; each draft response includes who the reply goes to (`replyTo`)
- Gmail draft creation on approval; edits to an approved draft are synced to Gmail before they are saved
- Replies use the original message's RFC `Message-ID` for `In-Reply-To`/`References` and keep Gmail's `threadId`
- Preferences and activity log APIs

Frontend:

- Login and register
- Top bar with Gmail connection status (connect / disconnect) and account menu
- Dashboard with an **Inbox** tab (search, unread filter, pagination) and a **Drafts** tab (filter by status)
- Email detail with AI draft generation
- Draft detail with editing, approve, reject, and send (with confirmation dialogs)

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
    styles.css          # Global design tokens and shared layout/state styles
    app/
      pages/            # Lazy-loaded pages
      services/         # API clients, auth interceptor and guard
      shared/           # Top bar, confirm dialog, formatting helpers
  tests/

docker-compose.yml
```

## Prerequisites

- Node.js 20.19.5 (pinned in `.nvmrc`; run `nvm use`). Angular 21's CLI needs Node ≥ 20.19, so older Node versions cannot build or test the frontend.
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

3. Fill in the secrets and keys (see [Local Development Setup](#local-development-setup) for how to generate them).

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
- The setup is optimized for local MVP/demo workflows rather than production-scale cloud deployment.

## Local Development Setup

Create `backend/.env`:

```env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:4200

MONGODB_URI=mongodb://localhost:27017/draftly

JWT_ACCESS_SECRET=replace-with-a-long-secret
JWT_REFRESH_SECRET=replace-with-a-different-long-secret
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

## Demo Flow

1. Run `docker compose up --build`.
2. Open `http://localhost:4200`.
3. Register or log in.
4. Click **Connect Gmail** (top bar) and complete Google OAuth.
5. Back on the dashboard, browse the **Inbox**: search with Gmail syntax (e.g. `from:alice subject:"report"`), toggle **Unread only**, and use **Next**/**Previous**.
6. Open an email.
7. Choose a tone, optionally add context, and click **Generate draft**.
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
| 403 | Gmail access expired or was revoked — Gmail is marked disconnected; reconnect |
| 404 | Not found, including another user's draft or email, or a malformed id |
| 409 | Invalid state: e.g. approving a non-pending draft, editing/sending a sent draft, a send already in progress, Gmail not connected, or a reply that would go to your own address |
| 413 | Request body too large |
| 422 | Nothing valid to reply to (e.g. a thread with no message from someone else) |
| 429 | Rate limit (failed logins, draft generation, or Gmail) |
| 502 | An upstream step failed: the Gmail draft could not be updated (edit not saved) or the AI returned an empty draft |

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

Login and register allow 5 **failed** attempts per 15 minutes per client IP; successful requests are not counted. Tokens are accepted only in the `Authorization` header (never from cookies).

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

The reply always targets a message from someone else: the unread incoming messages in the thread, or otherwise the latest incoming message — never your own messages. Generation is limited to 10 requests per minute per user.

Update draft body (max 50,000 chars):

```json
{
  "draftBody": "Updated draft text"
}
```

For an approved draft, the Gmail draft is updated first; if that fails, the edit is not saved and the API returns 502.

Reject works for `PENDING` drafts and for `APPROVED` drafts that are not being sent; for an approved draft, its Gmail draft is also deleted (best effort — if that fails, the draft is still rejected and the failure is logged).

Every draft response includes `replyTo: { "from": "...", "subject": "..." }` (or `null` if the original email is not cached).

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

Limit: this is a durable claim plus a stored result, not perfect exactly-once delivery. If the backend crashes after Gmail accepts the message but before MongoDB records it, the claim expires after 5 minutes; a retry then re-sends the same Gmail draft id, which Gmail rejects because sent drafts are deleted.

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

`signature` is at most 1000 characters; `learningEmailCount` is an integer from 1 to 20.

### Logs

```http
GET /api/logs?limit=100&skip=0
GET /api/logs/:entityType/:entityId
```

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
```

Frontend:

```bash
cd frontend
npm start
npm run build
npm test
npm run test:coverage
```

## Testing Status

Backend tests cover services, controllers, middleware, models, and API workflows against an in-memory MongoDB — including send idempotency under concurrency, OAuth hardening, rate limits, cross-user access, and reply-header injection attempts. Frontend tests cover services, the auth interceptor, and page/component behaviour (search and pagination, drafts, dialogs, error states).

Last verified with Node 20.19.5:

| | Test files | Tests | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|---|
| Backend | 22 | 336 passing | 95.5% | 84.48% | 99.18% | 95.5% |
| Frontend | 4 | 78 passing | 93.67% | 80.1% | 93.66% | 94.23% |

Validation before a demo:

```bash
nvm use
cd backend && npx tsc --noEmit && npm test && npm run test:coverage
cd frontend && npm test && npm run test:coverage && npm run build
docker compose up --build
```

`npm run build` reports one warning: the initial bundle (≈527 kB) is above Angular's 500 kB warning budget; the hard limit is 1 MB.

Some backend test output includes logged error stack traces from tests that exercise failure paths on purpose; they are not failures.

## Design Notes

- The backend separates routes, controllers (validation and status codes), services (business logic), models, middleware, and config. Services throw typed errors; one shared helper turns them into responses.
- Drafts use explicit statuses: `PENDING`, `APPROVED`, `REJECTED`, and `SENT`. Sending is only allowed after approval.
- Approval creates a Gmail draft, so the user can also inspect it in Gmail before sending. Unsaved edits are saved (and synced to Gmail) before approve or send, so what is sent is what is on screen.
- Reply messages are built in one place: header values are stripped of line breaks, the recipient is reduced to a single parsed address, non-ASCII subjects are encoded, and bodies are base64-encoded.
- A reply is never addressed to the user: reply targets are always messages from someone else, and approve/send refuse a draft whose recipient is the user's own address.
- User style learning retrieves recent outbound emails and includes them (truncated) as examples in the OpenAI prompt.
- The app keeps the human-in-the-loop requirement by never sending generated text automatically.
- Request logs redact OAuth codes, OAuth state, and search queries.

## Known Limitations

- Optimized for local Docker Compose deployment and demos rather than production cloud deployment (MongoDB runs without authentication on the internal Docker network).
- Sending is idempotent but not mathematically exactly-once (see [Idempotent sending](#idempotent-sending)).
- Replies go to the sender only: there is no reply-all, and a `Reply-To` header is not used.
- Thread context comes from cached messages, i.e. messages that have appeared in an inbox listing.
- For HTML-only emails the cached plain-text body is empty, so the AI sees little of their content.
- Rate limits are kept in memory per backend process.
- Refresh tokens are stateless JWTs: logout clears them in the browser, but a copied refresh token stays valid until it expires. Tokens are stored in `localStorage`.
- Email HTML is sanitized and shown inline; remote images in emails load when an email is opened.
- The OAuth `state` is signed and expiring but not tied to the browser that started the flow.
- The Drafts tab shows the latest 50 drafts. Preferences and activity logs have APIs but no frontend screens yet.

## Future Improvements

- Cloud deployment (AWS/GCP/Azure) with production-grade secrets management
- CI/CD pipeline for automated testing and deployment
- Retry with backoff for transient Gmail failures
- Reply-all and `Reply-To` support
- Plain-text extraction for HTML-only emails
- Preferences and activity log screens
- Server-side refresh-token revocation
