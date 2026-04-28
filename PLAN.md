# Draftly (Gmail AI Reply Agent) — 1 Week Execution Plan (Angular + Express + MongoDB)

This document is designed so you can continue the project using **GitHub Copilot** without me.

## Current repo status (already done)

- Node upgraded via `nvm` and pinned via `.nvmrc` (20.19.5)
- `backend/` initialized with dependencies + TypeScript config
- `backend/.env.example` created
- Basic backend files started:
  - `backend/src/config/env.ts`
  - `backend/src/utils/logger.ts`

## Goal / Success criteria

By end of week you should have:

1. Multi-tenant app with **users** (register/login)
2. Per-user **Gmail OAuth2** connection (store encrypted tokens)
3. Fetch unread/recent emails from Gmail
4. Generate **draft replies** using **OpenAI GPT-4** with tone option
5. Draft workflow: view / edit / approve / reject
6. Send approved replies via Gmail API with proper threading
7. Store drafts + sent emails + status history + logs in MongoDB
8. Minimal Angular UI for the core flows
9. Docker + README + demo steps

## Architecture (high level)

- **Backend**: Node 20, Express, MongoDB (Mongoose), JWT auth
- **Frontend**: Angular
- **Integrations**:
  - Google OAuth2 + Gmail API (`googleapis`)
  - OpenAI API (`openai` SDK)

### Services

- AuthService (users, JWT)
- CryptoService (AES-256-GCM encrypt/decrypt)
- GmailService (oauth URL, callback, refresh token, fetch emails, send reply)
- DraftService (create/get/update/approve/reject/send)
- OpenAIService (draft generation)
- LoggingService (activity logs)

## Data model (MongoDB)

Implement these collections with Mongoose:

1. `User`
   - email (unique), passwordHash, name

2. `GmailAccount`
   - userId
   - gmailEmail
   - accessTokenEnc
   - refreshTokenEnc
   - tokenExpiry
   - scopes[]
   - revokedAt?

3. `UserPreference`
   - userId
   - defaultTone: `formal | concise | friendly`
   - signature
   - learningEmailCount (default 5)

4. `EmailMessage`
   - userId
   - gmailMessageId
   - threadId
   - from, to, subject
   - snippet
   - bodyPlain
   - internalDate
   - direction: `INBOUND | OUTBOUND`

5. `Draft`
   - userId
   - gmailMessageId (original)
   - threadId
   - tone
   - promptVersion
   - draftBody
   - status: `PENDING | APPROVED | REJECTED | SENT`
   - approvedAt?, rejectedAt?, sentAt?
   - sentGmailMessageId?
   - idempotencyKey (for send)
   - auditTrail: [{ at, action, by, meta }]

6. `ActivityLog`
   - userId
   - action
   - entityType, entityId
   - level: info/warn/error
   - meta
   - createdAt

## API endpoints (REST)

### Auth

- `POST /api/auth/register` {name,email,password}
- `POST /api/auth/login` {email,password}
- `GET /api/auth/me`

### Gmail OAuth

- `GET /api/gmail/oauth/url` → returns URL
- `GET /api/gmail/oauth/callback?code=...` → stores tokens
- `POST /api/gmail/disconnect`

### Emails

- `GET /api/emails?label=INBOX&unread=true&limit=20`
- `GET /api/emails/:gmailMessageId`

### Drafts

- `POST /api/drafts/generate` { gmailMessageId, tone? }
- `GET /api/drafts?status=PENDING`
- `GET /api/drafts/:id`
- `PUT /api/drafts/:id` { draftBody }
- `POST /api/drafts/:id/approve`
- `POST /api/drafts/:id/reject`
- `POST /api/drafts/:id/send` { idempotencyKey }

### Preferences

- `GET /api/preferences`
- `PUT /api/preferences` { defaultTone, signature, learningEmailCount }

### Logs

- `GET /api/logs?limit=100`

## Security requirements

1. Password hashing: bcrypt
2. JWT auth for backend API
3. Encrypt Gmail OAuth tokens at rest: AES-256-GCM
4. CORS locked to Angular URL
5. Rate limit auth endpoints
6. Never store raw tokens unencrypted

## Prompting strategy (simple “learning”)

For “learning user style”, do **simple retrieval**:

1. Pull last `N` outbound emails (`EmailMessage` direction OUTBOUND)
2. Put them in the prompt as examples (“Here are examples of my writing style”)

## Threading rules for Gmail replies

When sending reply:

- Use `threadId`
- Add headers:
  - `In-Reply-To: <messageId>`
  - `References: <messageId>`
- Use `users.messages.send` with raw RFC822 message

## Idempotency + retries (send)

- Require `Idempotency-Key` header or body field.
- Store it on Draft when sending.
- If same key used again and status is SENT, return previous result.
- Retry Gmail send on 429/5xx with exponential backoff (max 3).

## 7-day implementation schedule (aggressive)

### Day 1 — Backend foundation + Angular scaffold

Backend:
- Create missing server scaffolding: app, routes, db connect, error handler
- Create base models: User, GmailAccount, Preferences
- Create auth routes (register/login/me)

Frontend:
- `ng new frontend` (Angular)
- Create login/register pages, store JWT, basic route guard

### Day 2 — Gmail OAuth + token encryption

- CryptoService (encrypt/decrypt)
- Gmail OAuth URL + callback
- Store encrypted tokens in GmailAccount
- Implement token refresh on demand

### Day 3 — Email fetch + OpenAI draft generation

- Fetch unread/recent emails into `EmailMessage`
- Draft generation endpoint:
  - fetch thread context
  - fetch last N outbound emails
  - prompt GPT-4 with tone + signature
  - store Draft with status PENDING

### Day 4 — Draft workflow

- Draft list/detail endpoints
- Edit endpoint
- Approve/reject endpoints
- Activity log for each state change

### Day 5 — Send flow

- Implement Gmail reply sending (threading)
- Idempotency + retries
- Mark draft SENT + store sent message id

### Day 6 — Angular UI for workflows

- Gmail connect button
- Inbox list
- Draft list and draft detail
- Approve/reject/send buttons

### Day 7 — Docker + docs + demo

- Dockerfiles + docker-compose (mongo + backend + frontend)
- README with setup
- Short “demo script” steps

## Copilot-friendly tasks (copy into GitHub issues)

1. Backend: add missing files `src/server.ts`, `src/app.ts`, `src/routes/*`, error middleware
2. Backend: mongoose models for User/GmailAccount/UserPreference/EmailMessage/Draft/ActivityLog
3. Backend: JWT middleware + auth controller
4. Backend: AES-256-GCM crypto util
5. Backend: Gmail OAuth flow + token refresh
6. Backend: Fetch emails + parse body
7. Backend: OpenAI draft generation
8. Backend: Draft state machine + audit log
9. Backend: Send reply + threading + idempotency + retries
10. Frontend: Angular pages for login/register/dashboard/inbox/drafts
11. Docker + README

## Notes / shortcuts to meet 1-week deadline

- Keep UI minimal (one dashboard page is fine)
- Don’t overbuild role-based access
- Skip full test suite; add a couple smoke tests only
- Prefer “works end-to-end” over perfect abstraction
