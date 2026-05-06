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
   - gmailMessageId (original, or array if consolidated from multiple)
   - threadId
   - tone
   - promptVersion
   - draftBody
   - status: `PENDING | APPROVED | REJECTED | SENT`
   - approvedAt?, rejectedAt?, sentAt?
   - sentGmailMessageId?
   - gmailDraftId? (stores Gmail draft ID when saved to Gmail)
   - idempotencyKey (for send)
   - auditTrail: [{ at, action, by, meta }]
   - isConsolidated? (true if generated from multiple emails in thread)

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

- `POST /api/drafts/generate` { gmailMessageId (or threadId for consolidation), tone? }
- `GET /api/drafts?status=PENDING`
- `GET /api/drafts/:id`
- `PUT /api/drafts/:id` { draftBody } (updates both MongoDB + Gmail draft)
- `POST /api/drafts/:id/approve` (saves to MongoDB + saves as Gmail draft, status → APPROVED)
- `POST /api/drafts/:id/reject` (status → REJECTED)
- `POST /api/drafts/:id/send` { idempotencyKey } (sends via Gmail API, status → SENT, stores sentGmailMessageId)

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

## Draft Workflow (NEW — Missing Feature + D5)

### Approval Flow
When user clicks **Approve**:
1. Save draft to MongoDB with status = APPROVED
2. Create/update draft in Gmail using `users.drafts.create()` or `users.drafts.update()`
3. Store returned `gmailDraftId` in Draft model
4. User can now see it in Gmail's drafts folder

### Edit Flow
When user clicks **Edit** (after approve):
1. Update `draftBody` in MongoDB
2. Update the Gmail draft via `users.drafts.update(gmailDraftId)` with new body
3. Keep both in sync

### Send Flow
When user clicks **Send** (after approve):
1. Fetch Draft from MongoDB
2. Fetch the latest Gmail draft (or compose fresh if needed)
3. Send via `users.messages.send()` with:
   - Proper threading headers (In-Reply-To, References)
   - threadId for Gmail API
   - idempotencyKey for deduplication
4. Mark Draft status = SENT
5. Store sentGmailMessageId
6. Create EmailMessage record (direction: OUTBOUND) with the sent message
7. Optionally delete the draft from Gmail (or leave it)

### Multi-Email Consolidation (D5 Enhancement)
When generating drafts:
1. If `threadId` provided, fetch ALL unread/recent emails in that thread
2. If multiple emails:
   - Mark Draft as `isConsolidated: true`
   - Store array of `gmailMessageId`s
   - In prompt: "You have received multiple emails. Here's the full context: [email1] [email2]..."
3. If single email: generate draft normally
4. Result: ONE draft that addresses all emails in thread

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

### Day 5 — Send flow + Gmail draft saving (PRIORITY)

**Gmail Draft Saving (Missing Feature)**:
- Implement `users.drafts.create()` when user clicks Approve
- Store `gmailDraftId` in Draft model
- Implement `users.drafts.update()` for edit endpoint
- Implement `users.drafts.send()` or `users.messages.send()` for send

**D5 — Enhanced Send Flow**:
- Implement Gmail reply sending (threading)
- Idempotency + retries
- Mark draft SENT + store sent message ID
- Create outbound EmailMessage record for sent message

**D5 — Multi-Email Consolidation**:
- Fetch all unread/recent emails in thread (not just latest)
- If multiple: generate ONE draft addressing all
- Mark as `isConsolidated: true` with array of message IDs

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
## CURRENT SPRINT: Gmail Draft Saving + D5 Send Flow

### Implementation Breakdown

#### Backend Tasks

**1. Update Draft Model**
- [ ] Add `gmailDraftId?: string` field
- [ ] Add `isConsolidated?: boolean` field
- [ ] Update `gmailMessageId` to support `string | string[]`

**2. GmailService enhancements**
- [ ] `createDraft(userId, to, subject, bodyHtml, threadId)` → returns gmailDraftId
- [ ] `updateDraft(userId, gmailDraftId, bodyHtml)` → updates Gmail draft
- [ ] `sendDraftFromGmail(userId, gmailDraftId, threadId, inReplyTo, references)` → sends + returns sentMessageId
- [ ] `deleteDraft(userId, gmailDraftId)` → optional cleanup
- [ ] `fetchThreadEmails(userId, threadId)` → returns all emails in thread (for consolidation)

**3. DraftService enhancements**
- [ ] `approveDraft(draftId)` → save to MongoDB + call `GmailService.createDraft()` to save in Gmail
- [ ] `editDraft(draftId, newBody)` → update MongoDB + call `GmailService.updateDraft()` to sync Gmail
- [ ] `sendDraft(draftId, idempotencyKey)` → check idempotency → send via Gmail → mark SENT → store sentGmailMessageId
- [ ] Update `generateDraft()` logic:
  - Accept `threadId` (instead of just gmailMessageId)
  - Fetch all unread emails in thread
  - If multiple: consolidate into one prompt + mark `isConsolidated: true`
  - If one: normal flow

**4. New endpoint: POST /api/drafts/:id/approve**
- Save to MongoDB (status = APPROVED)
- Call GmailService.createDraft()
- Return updated draft with gmailDraftId

**5. Update endpoint: PUT /api/drafts/:id**
- Update draftBody in MongoDB
- If gmailDraftId exists, call GmailService.updateDraft()
- Maintain sync between MongoDB and Gmail

**6. New endpoint: POST /api/drafts/:id/send**
- Verify draft status = APPROVED
- Check idempotency key (avoid double-send)
- Call GmailService.sendDraftFromGmail() or compose message with threading headers
- Mark status = SENT, store sentGmailMessageId
- Create EmailMessage record (direction: OUTBOUND)
- Log activity

#### Frontend Tasks

**1. Update Draft Detail UI**
- Show 3 buttons: **Approve**, **Reject**, **Send** (instead of approve + send combined)
- **Approve**: Changes status to APPROVED + shows Gmail draft saved message
- **Reject**: Changes status to REJECTED
- **Send**: Only enabled if status = APPROVED, sends email

**2. Draft Status Indicator**
- PENDING → edit allowed, no send
- APPROVED → edit + send allowed, Gmail draft exists
- REJECTED → no actions
- SENT → read-only, show sent timestamp + message ID

**3. Edit Form**
- Allow editing only in PENDING or APPROVED states
- Show "Syncing to Gmail..." during edit if gmailDraftId exists

#### Testing Checklist

- [ ] Approve draft → verify saved in MongoDB with status APPROVED
- [ ] Verify gmailDraftId returned and stored
- [ ] Check Gmail: draft appears in Drafts folder
- [ ] Edit draft → verify changes sync to Gmail
- [ ] Reject draft → status changes, no Gmail draft created
- [ ] Send approved draft → email sent, status = SENT, sentGmailMessageId stored
- [ ] Send with idempotency key → retry returns same result
- [ ] Multi-email thread consolidation → single draft generated for all emails
- [ ] Check outbound EmailMessage created after send