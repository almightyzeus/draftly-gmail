# Draftly: Gmail AI Reply Agent

Draftly is a local MVP for the Airtribe Backend Engineering Launchpad capstone. It connects to Gmail, fetches inbox emails, generates AI reply drafts, lets the user review/edit/approve/reject drafts, and sends approved replies through Gmail.

The project is intentionally scoped as an MVP. The core workflow is implemented, containerized with Docker, and demoable locally using Docker Compose.

## Capstone Objective

Professionals spend time writing routine replies such as acknowledgements, follow-ups, confirmations, and meeting responses. Draftly automates the first draft while keeping the user in control before anything is sent.

The system supports:

- Gmail OAuth2 connection
- Fetching unread or recent inbox emails with sender, subject, body, timestamp, and thread ID
- AI-generated reply drafts with tone options
- Thread context and user style examples from previous outbound emails
- Draft review, edit, approval, rejection, and sending
- Storage of users, Gmail accounts, emails, drafts, preferences, and activity logs
- Encrypted Gmail token storage

## Tech Stack

- Backend: Node.js, Express, TypeScript
- Database: MongoDB with Mongoose
- Frontend: Angular
- AI: OpenAI API
- Gmail: Google OAuth2 and Gmail API
- Auth: JWT
- Security: bcrypt password hashing, AES-256-GCM token encryption, Helmet, CORS, auth rate limiting

## Architecture Overview

- Angular frontend served through nginx
- nginx reverse proxy forwards `/api` requests to the backend container
- Express backend exposes REST APIs and integrates with Gmail/OpenAI
- MongoDB stores users, emails, drafts, preferences, and activity logs
- Docker Compose orchestrates frontend, backend, and MongoDB services locally

## Current MVP Status

Implemented:

- User registration, login, and authenticated routes
- Gmail OAuth connect and revoke
- Gmail email fetch into MongoDB
- AI draft generation using tone, thread context, signature, and recent outbound style examples
- Draft list/detail/update/approve/reject/send APIs
- Gmail draft creation on approval
- Gmail draft update after editing an approved draft
- Gmail draft send for approved drafts
- Basic preferences and activity log APIs
- Angular UI for login, register, dashboard/inbox, email detail, and draft detail

Known limitations:

- The project is optimized for local Docker Compose deployment and demo usage rather than production cloud deployment.
- Backend and frontend tests are passing with coverage above the MVP target.
- Send retry/backoff is not fully implemented.
- Send idempotency requires a key and prevents obvious duplicate status transitions, but it is not a complete production-grade idempotency store.
- Gmail threading is implemented with Gmail thread IDs and reply headers, but should be hardened further for production.
- Preferences and logs are exposed as basic APIs but do not yet have full frontend screens.

## Project Structure

```text
backend/
  src/
    app.ts
    server.ts
    config/
    controllers/
    middleware/
    models/
    routes/
    services/
    utils/
  tests/

frontend/
  nginx.conf
  src/app/
    pages/
    services/

docker-compose.yml
```

## Prerequisites

- Node.js 20.19.5
- Google Cloud OAuth2 credentials with Gmail API enabled
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

All other environment variables remain the same as local development.

### Start the Full Stack

From the project root:

```bash
docker compose up --build
```

### Services

| Service | URL |
|---|---|
| Frontend | http://localhost:4200 |
| Backend API | http://localhost:3000 |
| MongoDB | mongodb://localhost:27017 |

### Stop the Stack

```bash
docker compose down
```

### Notes

- MongoDB data is persisted using Docker volumes.
- Frontend API calls continue to use `/api` routes through nginx reverse proxying.
- Docker Compose orchestrates frontend, backend, and MongoDB containers locally.
- The setup is optimized for local MVP/demo usage rather than production cloud deployment.

## Local Development Setup

Create `backend/.env`:

```env
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:4200

MONGODB_URI=mongodb://localhost:27017/draftly

JWT_ACCESS_SECRET=replace-with-a-long-secret
JWT_REFRESH_SECRET=replace-with-a-long-secret
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

DATA_ENCRYPTION_KEY_BASE64=replace-with-base64-encoded-32-byte-key

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/oauth/callback

OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
```

To generate the encryption key:

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

In Docker Compose, nginx reverse proxying is used so frontend API calls continue to work with `/api` routes without frontend code changes.

## Gmail OAuth Setup

In Google Cloud Console:

1. Create or select a project.
2. Enable Gmail API.
3. Configure OAuth consent screen.
4. Create OAuth 2.0 credentials.
5. Add this redirect URI:

```text
http://localhost:3000/api/gmail/oauth/callback
```

The backend requests Gmail read, modify, and send scopes.

## Demo Flow

1. Run `docker compose up --build`.
2. Open `http://localhost:4200`.
3. Register or log in.
4. Click "Connect Gmail" and complete Google OAuth.
5. Return to the dashboard and fetch inbox emails.
6. Open an email.
7. Select a tone and generate a draft.
8. Edit the draft if needed.
9. Approve the draft. This creates a Gmail draft.
10. Send the approved draft.

## REST API

All protected endpoints require:

```http
Authorization: Bearer <accessToken>
```

### Auth

```http
POST /api/auth/register
POST /api/auth/login
GET /api/auth/me
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

### Gmail

```http
GET /api/gmail/oauth/connect
GET /api/gmail/oauth/callback?code=...&state=...
POST /api/gmail/oauth/revoke
GET /api/gmail/emails?label=INBOX&unread=true&limit=20
GET /api/gmail/emails/:gmailMessageId
```

### Drafts

```http
POST /api/drafts/generate
GET /api/drafts
GET /api/drafts/:id
PUT /api/drafts/:id
POST /api/drafts/:id/approve
POST /api/drafts/:id/reject
POST /api/drafts/:id/send
```

Generate draft body:

```json
{
  "gmailMessageId": "gmail-message-id",
  "tone": "formal",
  "customContext": "Optional extra context"
}
```

Update draft body:

```json
{
  "draftBody": "Updated draft text"
}
```

Send draft body:

```json
{
  "idempotencyKey": "unique-send-key"
}
```

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

### Logs

```http
GET /api/logs?limit=100&skip=0
GET /api/logs/:entityType/:entityId
```

## Data Models

Main collections:

- `User`
- `GmailAccount`
- `UserPreference`
- `EmailMessage`
- `Draft`
- `ActivityLog`

Gmail access and refresh tokens are encrypted before storage.

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

Backend tests cover services, models, middleware, controllers, and critical API workflows. The backend test suite currently passes, and coverage is above the MVP target:

- Statements: 84%+
- Lines: 84%+
- Functions: 91%+
- Branches: 61%+

Frontend tests use Vitest and cover service APIs plus page/component class behavior. Frontend coverage is also above the MVP target:

- Statements: 89%+
- Lines: 89%+
- Functions: 93%+
- Branches: 82%+

For submission, the recommended validation is:

1. `cd backend && npm run build`
2. `cd backend && npm test`
3. `cd backend && npm run test:coverage`
4. `cd frontend && npm run build`
5. `cd frontend && npm test`
6. `cd frontend && npm run test:coverage`
7. Run the local demo flow from registration through sending an approved Gmail draft.

## Design Notes

- The backend separates routes, services, models, middleware, and config.
- Drafts use explicit statuses: `PENDING`, `APPROVED`, `REJECTED`, and `SENT`.
- Sending is only allowed after approval.
- Approval creates a Gmail draft so the user can inspect it in Gmail before sending.
- User style learning is implemented by retrieving recent outbound emails and including them as examples in the OpenAI prompt.
- The app keeps the human-in-the-loop requirement by never sending generated text automatically.

## Future Improvements

- Cloud deployment (AWS/GCP/Azure)
- Production-grade secrets management
- CI/CD pipeline for automated testing and deployment
- Stronger retry and backoff for Gmail send failures
- More complete idempotency table for send requests
- Full preferences and activity log UI
- More robust Gmail RFC Message-ID handling
- Better token refresh persistence
