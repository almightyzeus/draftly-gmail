# 📧 Draftly — AI-Powered Gmail Reply Agent

**Draftly** is an intelligent email assistant that uses OpenAI's GPT-4 to generate, review, and send reply drafts directly from Gmail. Perfect for managing high-volume inboxes with consistent, personalized responses.

---

## 🎯 Features

### Core Functionality
- **User Authentication**: Secure registration, login, and JWT-based sessions
- **Gmail OAuth2 Integration**: Seamless Gmail account connection with encrypted token storage
- **Email Fetching**: Retrieve unread/recent emails from Gmail inbox
- **AI Draft Generation**: Generate intelligent replies using GPT-4 with tone customization
- **Draft Workflow**: Review, edit, approve, or reject drafts before sending
- **Gmail Integration**: Save drafts to Gmail, sync edits, and send via Gmail API with proper threading
- **Multi-Email Consolidation**: Generate single replies addressing multiple emails in a thread
- **Activity Logging**: Track all user actions and email processing events
- **User Preferences**: Customize tone, signature, and learning email count

### Security
- ✅ JWT-based authentication with access/refresh token rotation
- ✅ AES-256-GCM encryption for Gmail OAuth tokens at rest
- ✅ bcryptjs password hashing
- ✅ CORS locked to frontend URL
- ✅ Rate limiting on auth endpoints
- ✅ Helmet.js security headers
- ✅ Idempotent send operations to prevent duplicate emails

---

## 🏗️ Architecture

### Tech Stack
```
Frontend:        Angular 18+ (TypeScript, RxJS)
Backend:         Node.js 20.19.5, Express.js, TypeScript
Database:        MongoDB (Mongoose ODM)
Authentication:  JWT (HS256)
Encryption:      AES-256-GCM
AI Engine:       OpenAI GPT-4
Email Service:   Gmail API (OAuth2)
Logging:         Pino
```

### System Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     Angular Frontend                         │
│  (Login, Dashboard, Inbox, Drafts, Gmail Connect)           │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST + JWT
┌────────────────────▼────────────────────────────────────────┐
│                  Express.js Backend                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Auth Service  │ Gmail Service  │ Draft Service      │    │
│  │ Crypto Service│ OpenAI Service │ Preference Service │    │
│  │ Activity Log  │                                      │    │
│  └─────────────────────────────────────────────────────┘    │
└────┬──────────────────┬──────────────────┬──────────────────┘
     │                  │                  │
     │                  │                  │
┌────▼───┐      ┌───────▼───────┐   ┌─────▼──────┐
│ MongoDB │      │  Gmail API    │   │ OpenAI API │
│  (Data) │      │  (OAuth2)     │   │  (GPT-4)   │
└─────────┘      └───────────────┘   └────────────┘
```

### Data Models
```
User
├── email (unique, indexed)
├── name
├── passwordHash (bcrypt)
├── googleConnected (boolean)
└── gmailEmail

GmailAccount
├── userId (FK)
├── gmailEmail
├── accessTokenEnc (AES-256-GCM)
├── refreshTokenEnc (AES-256-GCM)
├── tokenExpiry
└── scopes[]

UserPreference
├── userId (FK)
├── defaultTone (formal|concise|friendly)
├── signature
└── learningEmailCount

EmailMessage
├── userId (FK)
├── gmailMessageId (unique per Gmail)
├── threadId
├── from, to, subject
├── snippet
├── bodyPlain, bodyHtml
├── internalDate
└── direction (INBOUND|OUTBOUND)

Draft
├── userId (FK)
├── gmailMessageId (string|string[])
├── threadId
├── tone
├── promptVersion
├── draftBody
├── gmailDraftId (optional)
├── status (PENDING|APPROVED|REJECTED|SENT)
├── isConsolidated (boolean)
├── idempotencyKey (for send)
├── approvedAt, rejectedAt, sentAt
├── sentGmailMessageId
└── auditTrail[]

ActivityLog
├── userId (FK)
├── action
├── entityType, entityId
├── level (info|warn|error)
├── meta (JSON)
└── createdAt
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: 20.19.5 (managed via `.nvmrc`)
- **MongoDB**: Local or Atlas connection string
- **Gmail API**: OAuth2 credentials from Google Cloud Console
- **OpenAI API**: API key with GPT-4 access
- **Git**: For version control

### Step 1: Clone & Install Dependencies

```bash
# Clone repository
git clone https://github.com/yourusername/draftly-gmail.git
cd draftly-gmail

# Use correct Node version
nvm use

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install

cd ..
```

### Step 2: Environment Configuration

#### Backend (.env)
Create `backend/.env`:
```env
# Server
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:4200

# Database
MONGODB_URI=mongodb://localhost:27017/draftly

# JWT Secrets (use `openssl rand -hex 32` to generate)
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Gmail OAuth2
GMAIL_CLIENT_ID=your_client_id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REDIRECT_URL=http://localhost:5000/api/gmail/oauth/callback
GMAIL_SCOPES=https://www.googleapis.com/auth/gmail.modify

# OpenAI
OPENAI_API_KEY=sk-your_key_here
OPENAI_MODEL=gpt-4

# Encryption (use `openssl rand -hex 16` for IV, `openssl rand -hex 32` for key)
ENCRYPTION_KEY=your_32_byte_hex_key
ENCRYPTION_IV=your_16_byte_hex_iv

# Logging
LOG_LEVEL=info
```

#### Frontend (environment.ts)
`frontend/src/environments/environment.ts`:
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:4200/api',
};

export const environment_prod = {
  production: true,
  apiUrl: 'http://localhost:4200/api',
};
```

### Step 3: Gmail OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project
3. Enable Gmail API
4. Create OAuth 2.0 credentials (Desktop app)
5. Download credentials JSON, extract values for `.env`
6. Add `http://localhost:3000/api/gmail/oauth/callback` to authorized redirects

### Step 4: Start Services

```bash
# Terminal 1: Start MongoDB (local)
mongod

# Terminal 2: Start backend
cd backend
npm run dev

# Terminal 3: Start frontend
cd frontend
npm start

# Open browser: http://localhost:4200
```

---

## 📚 API Documentation

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePassword123!"
}

Response:
{
  "user": {
    "id": "user_id",
    "email": "john@example.com",
    "name": "John Doe",
    "googleConnected": false
  },
  "tokens": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

#### Login User
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "SecurePassword123!"
}

Response: (same as register)
```

#### Get Current User
```http
GET /api/auth/me
Authorization: Bearer {accessToken}

Response: (user object)
```

### Gmail OAuth Endpoints

#### Get OAuth URL
```http
GET /api/gmail/oauth/url
Authorization: Bearer {accessToken}

Response:
{
  "url": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

#### OAuth Callback
```http
GET /api/gmail/oauth/callback?code={authCode}

Response:
{
  "message": "Gmail connected successfully",
  "gmailEmail": "user@gmail.com"
}
```

#### Disconnect Gmail
```http
POST /api/gmail/disconnect
Authorization: Bearer {accessToken}

Response:
{
  "message": "Gmail disconnected successfully"
}
```

### Email Endpoints

#### Fetch Emails
```http
GET /api/emails?label=INBOX&unread=true&limit=20
Authorization: Bearer {accessToken}

Response:
{
  "emails": [
    {
      "gmailMessageId": "msg_id",
      "threadId": "thread_id",
      "from": "sender@example.com",
      "to": "user@gmail.com",
      "subject": "Email Subject",
      "snippet": "Email preview...",
      "internalDate": "2024-05-06T10:00:00Z"
    }
  ],
  "total": 20
}
```

#### Get Email Detail
```http
GET /api/emails/:gmailMessageId
Authorization: Bearer {accessToken}

Response: (full email object with bodyPlain, bodyHtml)
```

### Draft Endpoints

#### Generate Draft
```http
POST /api/drafts/generate
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "gmailMessageId": "msg_id",
  "tone": "formal" | "concise" | "friendly" (optional)
}

Response:
{
  "id": "draft_id",
  "status": "PENDING",
  "draftBody": "Generated reply...",
  "tone": "formal",
  "gmailMessageId": "msg_id"
}
```

#### List Drafts
```http
GET /api/drafts?status=PENDING
Authorization: Bearer {accessToken}

Response:
{
  "drafts": [...],
  "total": 5
}
```

#### Get Draft Detail
```http
GET /api/drafts/:id
Authorization: Bearer {accessToken}

Response: (full draft object with auditTrail)
```

#### Edit Draft
```http
PUT /api/drafts/:id
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "draftBody": "Updated reply..."
}

Response: (updated draft object, synced to Gmail)
```

#### Approve Draft
```http
POST /api/drafts/:id/approve
Authorization: Bearer {accessToken}

Response:
{
  "status": "APPROVED",
  "gmailDraftId": "gmail_draft_id",
  "approvedAt": "2024-05-06T10:00:00Z"
}
```

#### Reject Draft
```http
POST /api/drafts/:id/reject
Authorization: Bearer {accessToken}

Response:
{
  "status": "REJECTED",
  "rejectedAt": "2024-05-06T10:00:00Z"
}
```

#### Send Draft
```http
POST /api/drafts/:id/send
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "idempotencyKey": "unique-key-for-idempotency"
}

Response:
{
  "status": "SENT",
  "sentAt": "2024-05-06T10:00:00Z",
  "sentGmailMessageId": "gmail_msg_id"
}
```

### Preference Endpoints

#### Get Preferences
```http
GET /api/preferences
Authorization: Bearer {accessToken}

Response:
{
  "defaultTone": "formal",
  "signature": "Best regards, John",
  "learningEmailCount": 5
}
```

#### Update Preferences
```http
PUT /api/preferences
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "defaultTone": "concise",
  "signature": "Thanks, John",
  "learningEmailCount": 10
}

Response: (updated preferences)
```

### Activity Log Endpoints

#### Get Activity Logs
```http
GET /api/logs?limit=100&level=info
Authorization: Bearer {accessToken}

Response:
{
  "logs": [
    {
      "action": "draft_generated",
      "entityType": "Draft",
      "entityId": "draft_id",
      "level": "info",
      "meta": {...},
      "createdAt": "2024-05-06T10:00:00Z"
    }
  ]
}
```

---

## 🧪 Testing

### Backend Tests
```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- authService.test.ts

# Watch mode
npm test -- --watch
```

**Coverage Target**: 70%+ on services, models, middleware

**Test Categories**:
- **Unit Tests**: Service business logic (auth, crypto, draft generation)
- **Integration Tests**: Critical workflows (register → oauth → draft → send)
- **Model Tests**: Mongoose schema validation
- **Middleware Tests**: Auth guard, error handling

### Frontend Tests
```bash
cd frontend

# Run unit tests
npm test

# Run with coverage
npm run test:coverage

# Run E2E (if configured)
npm run e2e
```

**Test Categories**:
- **Service Tests**: Auth, draft, gmail services
- **Guard Tests**: Route authentication
- **Component Tests**: Login, dashboard, draft detail (basic)

---

## 🐳 Docker Deployment

### Build & Run with Docker Compose

```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Manual Docker Build

**Backend**:
```bash
cd backend
docker build -t draftly-backend .
docker run -p 3000:3000 --env-file .env draftly-backend
```

**Frontend**:
```bash
cd frontend
docker build -t draftly-frontend .
docker run -p 80:80 draftly-frontend
```

---

## 📖 Workflow Demo

### 1. User Registration
```bash
# Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name": "John", "email": "john@example.com", "password": "Pass123!"}'

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com", "password": "Pass123!"}'
```

### 2. Connect Gmail
```bash
# Get OAuth URL
curl -X GET http://localhost:3000/api/gmail/oauth/url \
  -H "Authorization: Bearer {accessToken}"

# Copy URL, authorize in browser → redirects to callback with code
# Backend automatically stores encrypted tokens
```

### 3. Fetch & Generate Drafts
```bash
# Fetch unread emails
curl -X GET "http://localhost:3000/api/emails?unread=true" \
  -H "Authorization: Bearer {accessToken}"

# Generate draft for an email
curl -X POST http://localhost:3000/api/drafts/generate \
  -H "Authorization: Bearer {accessToken}" \
  -H "Content-Type: application/json" \
  -d '{"gmailMessageId": "msg_123", "tone": "formal"}'
```

### 4. Review & Approve
```bash
# Get draft
curl -X GET http://localhost:3000/api/drafts/{draftId} \
  -H "Authorization: Bearer {accessToken}"

# Approve (saves to Gmail drafts)
curl -X POST http://localhost:3000/api/drafts/{draftId}/approve \
  -H "Authorization: Bearer {accessToken}"
```

### 5. Send
```bash
# Send draft (with idempotency)
curl -X POST http://localhost:3000/api/drafts/{draftId}/send \
  -H "Authorization: Bearer {accessToken}" \
  -H "Content-Type: application/json" \
  -d '{"idempotencyKey": "unique-key-123"}'
```

---

## 🔒 Security Considerations

### Token Management
- Access tokens: 15-minute expiry
- Refresh tokens: 7-day expiry
- Store securely in httpOnly cookies (frontend)

### Gmail Token Encryption
- AES-256-GCM encryption for stored tokens
- Decrypted only when needed to call Gmail API
- IV rotates per token

### Rate Limiting
- 5 requests per 15 minutes on auth endpoints
- Prevents brute-force attacks

### CORS
- Locked to frontend URL in production
- Credentials allowed for cookie-based auth

### Input Validation
- Joi schemas for request payloads
- Email regex validation
- XSS protection via helmet.js

---

## 🛠️ Development

### Project Structure
```
backend/
├── src/
│   ├── app.ts           (Express app setup)
│   ├── server.ts        (Server startup)
│   ├── config/
│   │   └── env.ts       (Environment validation)
│   ├── models/          (Mongoose schemas)
│   ├── services/        (Business logic)
│   ├── controllers/     (Route handlers)
│   ├── routes/          (API routes)
│   ├── middleware/      (Auth, error handlers)
│   └── utils/           (Helpers, logger, errors)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── tsconfig.json
└── package.json

frontend/
├── src/
│   ├── app/
│   │   ├── pages/       (Components)
│   │   ├── services/    (HTTP services)
│   │   ├── guards/      (Route guards)
│   │   └── models/      (TypeScript interfaces)
│   ├── assets/
│   ├── styles.css
│   └── main.ts
├── angular.json
└── package.json
```

### Adding a New Feature
1. Update models (if needed)
2. Create service method
3. Create route + controller
4. Add unit + integration tests
5. Update frontend service + component
6. Document API endpoint

---

## 🚦 Troubleshooting

### MongoDB Connection Issues
```bash
# Check if MongoDB is running
ps aux | grep mongod

# Start MongoDB
brew services start mongodb-community

# Or connect to Atlas
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/draftly
```

### Gmail OAuth Fails
- Verify `GMAIL_REDIRECT_URL` matches Google Cloud Console
- Check that Gmail API is enabled
- Ensure scopes include `gmail.modify`

### OpenAI API Errors
- Verify API key is valid and has GPT-4 access
- Check rate limits
- Review OpenAI console for usage

### Token Expiry
- Frontend should catch 401 responses
- Automatically refresh using refresh token
- Retry failed request with new access token

### Draft Not Syncing to Gmail
- Check GmailAccount tokens are not expired
- Verify threadId is correct
- Check OpenAI is generating valid reply content

---

## 📈 Performance & Scalability

### Optimization Tips
- Cache Gmail labels list (doesn't change often)
- Batch email fetch with pagination
- Rate limit OpenAI requests (costs money)
- Compress email bodies before storing
- Use MongoDB indexes on userId, threadId, status

### Monitoring
- Log all errors with context
- Track draft generation time
- Monitor Gmail API quota usage
- Alert on failed sends (via email)

---

## 🔮 Future Enhancements

### Phase 2: Advanced Features
- **Multi-Account Support**: Connect multiple Gmail accounts
- **Smart Learning**: Analyze user's writing style from past emails for better tone matching
- **Batch Operations**: Generate drafts for 10+ emails at once
- **Template Library**: Save successful drafts as templates
- **Scheduled Send**: Queue drafts for sending at optimal times
- **A/B Testing**: Test different tones/templates, track open/response rates

### Phase 3: AI Improvements
- **Fine-tuning**: Train model on user's own email data
- **Context Window**: Include full conversation thread in generation
- **Sentiment Analysis**: Detect emotional tone of incoming email
- **Language Detection**: Auto-detect language, respond in same language
- **Summarization**: Summarize long email chains before generating reply

---

## 📝 Contributing

1. Fork repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature/your-feature`
5. Submit pull request

### Code Standards
- Use TypeScript with strict mode
- Format with Prettier
- Lint with ESLint
- Write tests for all services
- Keep functions small and focused

---

## 📄 License

MIT License — See LICENSE file for details

---
