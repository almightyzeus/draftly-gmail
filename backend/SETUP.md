# Backend Setup Guide

## Prerequisites

- Node.js 20.19.5 (pinned in `.nvmrc`)
- MongoDB running locally or Atlas connection string
- OpenAI API key
- Google OAuth2 credentials

## Installation

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Generate secrets

Run these commands to generate secure random keys:

```bash
# JWT Access Secret (32 bytes, base64-encoded)
openssl rand -base64 32

# JWT Refresh Secret (32 bytes, base64-encoded)
openssl rand -base64 32

# Encryption Key for OAuth tokens (32 bytes, base64-encoded)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Create `.env` file

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then fill in the values:

```env
# Server
PORT=3000
NODE_ENV=development

# MongoDB (local or Atlas)
MONGODB_URI=mongodb://localhost:27017/draftly

# JWT Secrets (paste the generated values from step 2)
JWT_ACCESS_SECRET=<paste-here>
JWT_REFRESH_SECRET=<paste-here>

# Encryption Key (32 bytes base64)
DATA_ENCRYPTION_KEY_BASE64=<paste-here>

# OpenAI (get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=sk-...

# Google OAuth2 (create at https://console.cloud.google.com/)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/oauth/callback

# Frontend URL
FRONTEND_URL=http://localhost:4200
```

### 4. Ensure MongoDB is running

**Local MongoDB:**
```bash
# Start MongoDB service
mongod
```

**Or use MongoDB Atlas:**
- Create a cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- Get the connection string and set `MONGODB_URI` to it

### 5. Start the development server

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### 6. Test the API

Health check:
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── env.ts           # Environment config with validation
│   ├── models/
│   │   ├── User.ts
│   │   ├── GmailAccount.ts
│   │   ├── UserPreference.ts
│   │   ├── EmailMessage.ts
│   │   ├── Draft.ts
│   │   ├── ActivityLog.ts
│   │   └── index.ts
│   ├── middleware/
│   │   └── auth.ts          # JWT authentication
│   ├── controllers/
│   │   └── authController.ts
│   ├── routes/
│   │   └── authRoutes.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── crypto.ts        # AES-256-GCM encryption
│   ├── app.ts               # Express app setup
│   └── server.ts            # Server entry point
├── .env.example
├── .env                     # (create from example)
├── package.json
└── tsconfig.json
```

## Key Features

### Authentication
- JWT-based authentication with access & refresh tokens
- Password hashing with bcryptjs
- Login/Register endpoints with rate limiting

### Security
- CORS configured to frontend URL
- Helmet for security headers
- Rate limiting on auth endpoints
- Encryption for stored sensitive data (OAuth tokens)

### Data Encryption
- AES-256-GCM encryption for OAuth tokens at rest
- Encryption key must be 32 bytes (256 bits)
- Automatic encryption/decryption via `crypto.ts` utility

### Error Handling
- Global error handler middleware
- Detailed error messages in development
- Sanitized errors in production

## API Endpoints (Auth)

### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "secure123"
}
```

### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "secure123"
}
```

### Get Current User
```bash
GET /api/auth/me
Authorization: Bearer <accessToken>
```

## Development

### Build
```bash
npm run build
```

### Production
```bash
npm run start
```

## Troubleshooting

### "Missing required env var" error
- Check that `.env` file exists
- Ensure all required variables are set
- Verify values are not empty or just whitespace

### "Invalid encryption key" error
- Key must be exactly 32 bytes when base64-decoded
- Generate new key with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

### "Failed to connect to MongoDB" error
- Verify MongoDB is running
- Check `MONGODB_URI` connection string
- For Atlas, whitelist your IP in security settings

### Port already in use
- Change `PORT` env var to different port (e.g., 3001)
- Or kill the process using the port

## Next Steps

See [PLAN.md](../PLAN.md) for the full implementation roadmap.
