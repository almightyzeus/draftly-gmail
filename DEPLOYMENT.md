# Draftly — Free Demo Deployment Plan

This is a plan for a **limited, invite-only demo** of the existing app on free hosting tiers:
a handful of known testers, Google OAuth in **Testing** mode, and a capped OpenAI budget. It
is not a production launch: the production requirements are in [PLAN.md §6.3](PLAN.md#63-production-deployment-requirements-not-done)
and in the P2/P3 lists at the end of this file.

Nothing here has been deployed yet. Provider facts were checked against official
documentation on **2026-11-13**; free tiers and policies change, so re-check each one
(the links are listed in [§12](#12-provider-facts-checked-2026-11-13)) before you rely on it.

Status: **plan only.** The recommended architecture needs three new deployment files
(not application code), which have not been added. See [§2.3](#23-what-the-repository-needs-for-option-a-not-yet-added).

---

## 1. Constraints taken from the code

| Fact | Where | Consequence for hosting |
|---|---|---|
| The frontend calls the API with relative URLs (`api/auth`, `api/gmail`, `api/drafts`, …) | `frontend/src/app/services/*.ts` | The app and the API must share one origin, or `/api` must be reverse-proxied from the app's origin. |
| CSP `connect-src 'self'` | `frontend/security-headers.conf` | A separate API domain would be blocked by the browser unless the CSP (and CORS) were changed. Same origin keeps both as they are. |
| nginx proxies `/api/` to `http://backend:3000` and listens on port 80 | `frontend/nginx.conf` | `backend` is the Docker Compose service name. The frontend image only works inside Compose. |
| `app.listen(env.port)`; `PORT` defaults to 3000 | `backend/src/server.ts`, `config/env.ts` | The backend is a long-running process, not a serverless handler. |
| At startup the backend connects to MongoDB, then retires duplicate pending drafts and builds the partial unique index `one_pending_draft_per_thread` | `server.ts`, `DraftService.enforceSinglePendingDraftPerThread` | Runs on every start, including each wake-up from sleep; a failed connection or index build exits the process. |
| Rate limits are in memory: 5 **failed** logins/registrations per 15 min per client IP; 10 generations per minute per user | `app.ts`, `routes/draftRoutes.ts` | They reset on every restart or spin-down and are per instance. The login limit depends on the correct client IP (`TRUST_PROXY`). |
| OpenAI: 60 s timeout, 2 retries | `services/openaiService.ts` | A worst-case generation can take **over 3 minutes** (3 × 60 s plus backoff), before counting the Gmail thread sync. Typical generations are much shorter, but they have not been timed on a hosted instance. |
| Gmail calls: 3 attempts, 0.5 s / 1 s backoff, `Retry-After` up to 4 s; no app-set request timeout | `utils/retry.ts`, `services/gmailService.ts` | The Gmail part of a request is not bounded by the app itself. |
| Nothing is written to the local filesystem; logs go to stdout (pino, JSON in production) | `utils/logger.ts` | Ephemeral container filesystems are fine: all state is in MongoDB. |
| helmet sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` on API responses (helmet default) | `app.ts` | Over HTTPS, browsers will remember HSTS for the host after the first API call. nginx does not add HSTS to the app pages. |
| OAuth callback redirects to `${FRONTEND_URL}/dashboard` (or `?gmailError=<code>`) | `controllers/gmailController.ts` | `FRONTEND_URL` must be the public HTTPS origin **without a trailing slash**. |
| OpenAI is only called for an email cached from the user's own Gmail; with nothing cached, generation stops at 404/422 first | `services/draftService.ts` | Only accounts that can connect Gmail (Google test users) can spend OpenAI credits. |

---

## 2. Hosting architecture

### 2.1 Options compared

| | **A. One container: nginx + backend (recommended)** | **B. Static frontend host + separate backend, `/api` rewritten** | **C. Vercel (static or serverless)** |
|---|---|---|---|
| Example | One Render free web service (Docker) | Render static site + Render free web service | Vercel Hobby |
| Same origin | Yes, exactly as in Docker Compose | Yes, if the host's rewrite proxies `/api/*` | Yes, with an external rewrite |
| Security headers, caching, SPA fallback | Existing `nginx.conf` rules, unchanged | Re-created in the host's dashboard | Re-created in a new `vercel.json` |
| Proxy timeout | No extra proxy; Render's own request limit is **not stated** in its docs | Render rewrite timeout **not stated**; whether rewrites forward POST bodies is **not stated** | External rewrites time out at **120 s**: shorter than the worst-case generation |
| Cold starts | One service sleeps (about 1 min to wake) | The backend sleeps; whether static sites sleep is not stated | Static: none; a serverless backend would need code changes |
| Backend exposed directly | No: Render forwards only one port, nginx's | Yes: the backend has its own public `onrender.com` URL | — |
| `TRUST_PROXY` | One path, so one hop count | Two paths (via the rewrite, and direct) with different hop counts, so no single value is right for both | — |
| Repo changes | Three new deployment files (§2.3) | None | `vercel.json`; for a serverless backend, application code changes |

**Recommendation: A.** It is the only option where every behaviour is already verified
(it is the Docker Compose setup with the two containers merged), it has no third-party
proxy timeout, it keeps one cold start, and it keeps the backend off the public internet,
so `TRUST_PROXY` has a single correct value.

**B** needs no repository changes and is a reasonable fallback, but three things it depends
on are not documented by Render: rewrites to an external URL forwarding `POST` bodies, a
rewrite timeout, and the forwarded headers. Test those first (§10) if you choose it.

**C is not recommended for this app.**
- The 120 s external-rewrite timeout is shorter than the worst-case generation (a timed-out
  request may still finish and save the draft on the backend, but the user sees an error).
- Running Express as a Vercel function would need application changes: the entry point
  (`app.listen`), the startup index task, and in-memory rate limits that would be per
  function instance.
- The Hobby plan is for "personal or non-commercial use" (Vercel Terms §4).

A serverless backend should not be used unless the worst-case generation is proven to fit
the platform's execution limit. Vercel Hobby's function limit is 300 s, but the Gmail part
of the request has no upper bound in the app.

### 2.2 How option A routes a request

```text
Browser ──HTTPS──▶ Render edge (TLS termination, HTTP→HTTPS redirect)
                     │ HTTP, port $PORT (10000)
                     ▼
                 nginx (same container)
                     ├── /api/*     → http://127.0.0.1:3000/api/*  (Node backend, same container)
                     ├── /index.html, SPA routes → index.html  (no-cache + security headers)
                     └── hashed main/chunk/styles files  (1-year immutable + security headers)
Backend ──TLS──▶ MongoDB Atlas, Gmail API, OpenAI API
```

What each concern needs in option A:

- **CSP and CORS.** The origin is unchanged, so the CSP needs no edit and CORS is not
  involved: browsers do not apply CORS to same-origin requests. `FRONTEND_URL` is still
  used for the OAuth redirects and the CORS header value.
- **Forwarded headers.** nginx appends the address it received the request from to
  `X-Forwarded-For` and sets `X-Forwarded-Proto` to `$scheme`. That is `http`, because
  Render terminates TLS; the backend does not read it. `TRUST_PROXY` (§5.2) tells Express
  how many of these hops to trust.
- **OAuth redirects.** Google redirects to `https://<app>/api/gmail/oauth/callback`. nginx
  proxies it to the backend, which redirects to `${FRONTEND_URL}/dashboard`. Locally the
  redirect URI points at port 3000 directly. In the hosted demo it goes through nginx like
  every other API call.
- **Timeouts.** nginx's default `proxy_read_timeout` is 60 s, which is too short for a slow
  generation (§1). The hosted nginx config should raise it for `/api/` (§2.3). Render's own
  request timeout is not documented, so whether a 3-minute request completes is
  **unverified**. If it is cut off, the backend may still save the draft, and reopening the
  email shows it.

### 2.3 What the repository needs for option A (not yet added)

This is the one deployment blocker found: **the repository has no image that runs nginx and
the backend together**, and the existing frontend image cannot run outside Compose. It needs
three new deployment files, outlined below. No application code changes are needed. They were
not added, pending your approval:

1. **`deploy/render/Dockerfile`** (root build context):
   - stage 1 builds the backend (`npm ci`, `npm run build`), as `backend/Dockerfile` does;
   - stage 2 builds the frontend (`npm ci`, `npm run build`), as `frontend/Dockerfile` does;
   - the final stage starts from `node:24-alpine`, adds nginx (`apk add nginx`), and copies in:
     - the backend `dist`, with production dependencies installed (`npm ci --omit=dev`);
     - the frontend `dist/frontend/browser`;
     - `security-headers.conf`, unchanged;
     - the nginx config from item 2;
     - the start script from item 3.
2. **`deploy/render/nginx.conf`**: the same rules as `frontend/nginx.conf`, with three changes:
   - `listen 10000;` (Render's default `PORT`);
   - `proxy_pass http://127.0.0.1:3000/api/;`;
   - `proxy_read_timeout 300s;` and `proxy_send_timeout 300s;` on `/api/`.

   Every other line stays the same: the headers include, the cache rules, `try_files` and
   `server_tokens off`.
3. **`deploy/render/start.sh`**: starts the backend with `PORT=3000` overriding the platform's
   `PORT` (otherwise the backend and nginx would both try to bind 10000), then runs nginx in
   the foreground. If either process exits, the container exits, so Render restarts it.

Optional, with the same approval: add `Strict-Transport-Security` to `security-headers.conf`
for the app pages (P-3; the app is HTTPS-only on Render).

Without these files, option B is the only no-change path.

### 2.4 nginx behaviour any host must preserve

| Behaviour | Current nginx rule | Option B (Render static site dashboard) |
|---|---|---|
| CSP and security headers on every app response | `include security-headers.conf` in each app location | **Headers**, path `/*`: the six headers from `security-headers.conf` with the same values. Render says header values are "sent as-is". It does not name CSP or say whether headers apply to rewritten responses, so check both. |
| SPA fallback | `try_files $uri $uri/ /index.html` | **Rewrite** `/*` → `/index.html`. Render applies rules only when no file exists at the path. |
| API proxy | `location /api/` → backend | **Rewrite** `/api/*` → `https://<backend>.onrender.com/api/*`. This rule must come before the SPA rewrite. |
| `index.html` revalidated on each load | `Cache-Control: no-cache` | Header on `/index.html` and on `/*`. Hashed files are overridden by the next rule. |
| Hashed build files cached for a year | `^/(main\|polyfills\|styles\|chunk)-[A-Za-z0-9_-]{8}\.(js\|css)$` → `public, max-age=31536000, immutable` | Headers on `/main-*`, `/polyfills-*`, `/styles-*`, `/chunk-*` |
| Missing hashed file → 404, not the app page | The regex location has no `try_files` fallback | Not reproducible with a `/*` rewrite: a stale chunk would get `index.html`. This is harmless for a demo. |
| No server version | `server_tokens off` | Not applicable |
| Fonts (`media/*.woff2`) | Served by `location /` (no long cache) | Default caching |

---

## 3. Services to create

| Service | Plan | Purpose |
|---|---|---|
| Render web service (Docker, option A) | Free | The app and the API, from `deploy/render/Dockerfile` |
| MongoDB Atlas cluster | Free cluster (formerly M0) | All persistent data |
| Google Cloud project | Free | OAuth client and Gmail API (can be the existing project, with a new redirect URI) |
| OpenAI project | Pay-as-you-go | A dedicated project and key for the demo, with a hard spend limit |

Option B instead uses a Render **static site** for the frontend (build command
`npm ci && npm run build`, root directory `frontend`, publish directory
`dist/frontend/browser`) plus a Render web service from `backend/Dockerfile`.

---

## 4. MongoDB Atlas

1. Create a **Free** cluster in the region closest to the Render service.
2. **Database access:** create a dedicated user, e.g. `draftly-demo`:
   - use a long random password;
   - give it the **readWrite** role on database `draftly` only, not `atlasAdmin`.

   Atlas requires authentication: "You must create database users to access the database."
3. **Network access:** Atlas accepts connections only from IP access list entries, and free
   clusters support no private endpoints or peering.
   - Preferred: add the Render service's **outbound IP ranges**, shown under Render
     dashboard → the service → **Connect** → **Outbound**. They are shared by all Render
     services in that region, so they narrow access without isolating it.
   - Fallback, only if that fails: `0.0.0.0/0`. With it, the database password is the only
     barrier, so make that choice deliberately and record it.
   - Add your own IP as a temporary entry (Atlas lets entries expire within 7 days) when you
     need `mongosh` or `mongodump`.
4. **Connection string:** `mongodb+srv://draftly-demo:<password>@<cluster>.mongodb.net/draftly?retryWrites=true&w=majority`.
   - TLS: Atlas requires TLS, and `mongodb+srv` connections use it by default.
   - URL-encode special characters in the password.
   - Logs: the backend replaces the password with `***` when it logs the URI at startup;
     the user name and host are still logged.
5. **Limits of a free cluster:**
   - 0.5 GB storage, 500 connections, 100 operations per second;
   - 10 GB in and 10 GB out per rolling 7 days (excess is throttled);
   - it is **paused after 30 days with zero connections**. A sleeping Render service holds
     no connections, so resume the cluster in Atlas if the demo goes unused for a month.
6. **Backups:** free clusters have **no free automated backups**. Atlas offers an optional
   paid backup subscription for them, in private preview ($0.10 per day, up to $3 a month),
   and no on-demand snapshots. For a demo, take a manual `mongodump` of the `draftly`
   database before and after a demo session.
7. **Indexes:** free clusters only exclude rolling index builds, and the docs list no
   restriction on partial indexes. Confirm on first start that the log shows
   `MongoDB connected` and then `Server running`: a failed index build stops the process.

---

## 5. Environment variables

All values are set in **Render → the service → Environment**. Never commit them: `.env`
and `.env.docker` are already git-ignored. For option B, they go on the backend service.

### 5.1 Checklist (from `backend/src/config/env.ts`)

| Variable | Required | Demo value / rule |
|---|---|---|
| `NODE_ENV` | No (default `development`) | **`production`**: JSON logs and no stack traces in error responses. The Dockerfile already sets it; set it explicitly too. |
| `PORT` | No (default 3000) | Option A: leave Render's default **10000** for nginx; the start script runs the backend on 3000. Option B: `10000` or unset. Render detects the port. |
| `MONGODB_URI` | **Yes** | The Atlas string from §4.4 |
| `JWT_ACCESS_SECRET` | **Yes** | New random value (`openssl rand -base64 32`). At least 32 characters, not the `.env.example` placeholder, and different from the refresh secret; otherwise the backend refuses to start. |
| `JWT_REFRESH_SECRET` | **Yes** | A different new random value. Changing it ends every Draftly session. |
| `JWT_ACCESS_EXPIRES_IN` | No (`15m`) | Leave as is |
| `JWT_REFRESH_EXPIRES_IN` | No (`7d`) | Leave as is, or shorten (e.g. `1d`) to limit how long a copied refresh token can be renewed from (P2) |
| `DATA_ENCRYPTION_KEY_BASE64` | **Yes** | 32 random bytes, base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). **Keep it stable**: it encrypts the stored Google tokens, and changing it makes every stored Gmail connection undecryptable, so all testers would have to reconnect. |
| `OPENAI_API_KEY` | **Yes** | The demo project's key (§7) |
| `OPENAI_MODEL` | No (`gpt-4o-mini`) | Leave as is unless you have a reason |
| `GOOGLE_CLIENT_ID` | **Yes** | From the OAuth client (§6) |
| `GOOGLE_CLIENT_SECRET` | **Yes** | From the OAuth client |
| `GOOGLE_REDIRECT_URI` | **Yes** (valid URL) | `https://<service>.onrender.com/api/gmail/oauth/callback`, exactly as registered in Google: scheme, case and trailing slash must match. Option B: the **static site's** host, so the callback goes through the rewrite. |
| `FRONTEND_URL` | No (default `http://localhost:4200`), but required here | `https://<service>.onrender.com`: the public app origin, with **no trailing slash** |
| `TRUST_PROXY` | No (default 0) | See §5.2. Do not copy Compose's `1` without checking. |
| `LOG_LEVEL` | No (`info` in production) | Leave as is; `debug` only while diagnosing |

Generate fresh secrets for the hosted demo; do not reuse the local `.env.docker` values.

### 5.2 `TRUST_PROXY`

`TRUST_PROXY` is the number of proxies in front of Express whose `X-Forwarded-For` entries
are trusted. Express then takes the client IP from the right end of that list.

- **Too low:** every request seems to come from a Render proxy. All users then share one
  login limiter, so one person's 5 failed logins lock everyone out for 15 minutes.
- **Too high:** a client can prepend a fake address to `X-Forwarded-For` and get a fresh
  login-limit bucket on every attempt.
- **Generation limit:** it is keyed by user ID, so this setting does not affect it.

In Docker Compose there is exactly one hop (nginx), hence `1`. On Render the path in option A
is the Render edge, then nginx, then Node. Render's docs say its load balancer terminates TLS
and forwards over HTTP, but **they do not document the forwarded headers or the hop count**.
The value has to be measured:

1. Deploy with `TRUST_PROXY=2`: nginx plus one Render proxy, the most likely value.
2. Load the app from a browser, note your public IP (any "what is my IP" page), and find
   your request in the Render logs. Each request log line starts with the client address
   Express computed (`:remote-addr`, which is `req.ip`).
3. If it shows your public IP, keep the value. If it shows a private or Render address
   (e.g. `10.x.x.x`), increase it by 1, redeploy and check again. Use the **smallest** value
   that shows your real IP.
4. Repeat after any Render networking change or a move to option B.

In option B the backend has two entry paths (direct, and through the static site's
rewrite), so no single value is correct for both. Accept that the login limiter is weaker
there; this is part of P2 (shared and accurate rate limiting).

---

## 6. Google Cloud (Google Auth Platform)

In <https://console.cloud.google.com/auth>, for the project that owns the OAuth client:

1. **APIs & Services → Library:** make sure the **Gmail API** is enabled.
2. **Branding:** set the app name, the user support email and the developer contact email.
3. **Audience:**
   - user type **External**;
   - publishing status **Testing** (do not press *Publish app*);
   - add each tester's Gmail address under **Test users**. The limit is 100; only listed
     users can grant access.
4. **Data access:** declare the three scopes the backend requests:
   - `gmail.readonly` and `gmail.modify`, both **restricted**;
   - `gmail.send`, **sensitive**.
5. **Clients → your Web client → Authorized redirect URIs:** add
   `https://<service>.onrender.com/api/gmail/oauth/callback`. Keep the localhost URI for
   local use.
   - Google requires HTTPS for non-localhost redirect URIs and an exact match.
   - `onrender.com` and `vercel.app` are on the Public Suffix List, so these hosts are
     acceptable.
   - Authorized JavaScript origins are not used by this server-side flow.
6. Put the client ID and secret in the Render environment (§5).

What testers see and what to tell them:

- **Warning screen.** Google shows a warning screen saying the app is unverified and the
  user has test access. They continue past it.
- **Expiry after 7 days.** Because the app is External and in Testing and requests more than
  basic profile scopes, the Gmail authorization and its refresh token **expire 7 days after
  consent**. After that:
  - the next Gmail call gets `invalid_grant`;
  - the backend marks Gmail as disconnected and the API returns 403;
  - the top bar shows **Connect Gmail**.

  Reconnecting is one click: **Connect Gmail**, choose the same Google account, consent
  again. Drafts and history are kept. Logging out of Draftly does not affect this; the
  Draftly session and the Google grant are separate (README → *Sessions, logout and the two
  kinds of tokens*).
- **Access removed.** Removing access at myaccount.google.com → Security → Third-party
  connections has the same effect as expiry. So does **Disconnect Gmail** in Draftly, which
  revokes the grant at Google.

**This is the testing exception, not a permanent state.** Testing mode, up to 100 test users
and 7-day tokens, is meant for development. A public app that uses restricted Gmail scopes and
stores or transmits Gmail data on a server must:
- pass Google's OAuth app verification;
- pass a security assessment by a Google-empanelled assessor (CASA);
- be reassessed at least every 12 months.

Until then, a published but unverified app shows the unverified-app screen and is capped at
100 users for the life of the project. That cap cannot be reset. This is P3 below.

---

## 7. OpenAI cost protection

1. **Dedicated project.** Create a project just for the demo (e.g. `draftly-demo`) and a key
   that belongs to it, preferably a project service-account key. Use that key only in Render.
   Revoking it, or the project's limit, then affects nothing else.
2. **Project spend limit:**
   - open Project settings → **Limits** → **Spend** → *Edit spend limit*;
   - set a small **monthly spend limit**;
   - turn on **Enforce a hard limit**.

   Once tracked spend reaches it, requests billed to the project return 429
   (`project_spend_limit_exceeded`).
3. **Enforcement is not instantaneous.** OpenAI states that "recorded spend can slightly
   exceed the configured amount" while the limit propagates. Choose the limit with that
   margin in mind.
4. **Alerts.** Set spend alerts below the limit (e.g. at 50% and 80%). **Alerts only notify;
   API traffic continues.**
5. **Optional: a tighter organization-level hard limit.** If this organization is used only
   for the demo, also set one. It covers every project.
6. **What the app does at the limit.** The OpenAI SDK retries the 429 (up to 2 retries); then
   generation fails. The app does not map this error, so the user sees a generic failure and
   no draft is saved. Raising the limit restores service after it propagates; otherwise it
   resets at the next monthly cycle.

What the app adds, and why it is not a cost control on its own:

- **Generation limit.** It is 10 per minute **per user**, in memory: it resets on every
  restart or spin-down. Over a month it bounds nothing: 10 per minute is 14,400 a day per
  user.
- **Who can spend.** Only Google test users can connect Gmail, and only connected users can
  reach OpenAI (§1). That bounds *who* can spend, not *how much*.
- **Prompt size.** Prompts are capped: 20 thread messages, truncated bodies and style
  examples, and at most 2,000 characters of custom context.

The project hard limit is the actual cap. Keep it even with a small tester list.

---

## 8. Deploy and build (option A, after §2.3 is approved and added)

1. Push the branch with `deploy/render/*` to GitHub.
2. In Render, create a **New → Web Service**:
   - connect the repository;
   - runtime **Docker**;
   - Dockerfile path `deploy/render/Dockerfile`, build context the repository root;
   - instance type **Free**;
   - region: the one used for Atlas.
3. **Health check path:** `/` (served by nginx; any 2xx/3xx within 5 seconds passes). The
   backend's `/health` is not routed through nginx; a check of `/api/auth/me` returns 401,
   which fails the check.
4. Add the environment variables from §5, then deploy.
5. Copy the service URL (`https://<service>.onrender.com`) and set `FRONTEND_URL` and
   `GOOGLE_REDIRECT_URI` from it (§5). Redeploy, then add the redirect URI in Google (§6.5).
6. Check `TRUST_PROXY` (§5.2).
7. Builds: Render runs the Docker build, including the Angular production build. Render
   does not document its build resources for the free tier. If the build stalls (as it can
   on low-memory machines locally), that is the first thing to look at. Build minutes count
   against the workspace's monthly pipeline minutes.

Local validation first, to make sure the deployed commit is green:

```bash
cd backend && npx tsc --noEmit && npm run typecheck:tests && npm run test:ci
cd ../frontend && npx tsc -p tsconfig.app.json --noEmit && npm run typecheck:tests && npm run test:coverage && npm run build
```

Also confirm that GitHub Actions passed for the commit you deploy.

---

## 9. Free-tier behaviour and recovery

| Situation | What happens | What to do |
|---|---|---|
| No traffic for 15 minutes | Render spins the service down. The next request wakes it in about a minute, and the backend reconnects to Atlas and rebuilds the index check. | Open the app a minute or two before a demo. In-memory rate limits reset each time. |
| Free hours used up | Render grants 750 free instance hours per workspace per month. A single service fits; when they run out, all free services are suspended until the next month. | Keep only one free web service awake |
| Random restart | "Render might restart a Free web service at any time." | Nothing to do: all state is in Atlas. A restart between Gmail accepting a send and MongoDB recording it is the accepted send limitation (PLAN.md §6.2). |
| Redeploy | The container filesystem is replaced (ephemeral); Atlas data stays. Rollback is limited to the two previous deploys. | — |
| Atlas paused after 30 days without connections | The backend cannot connect and exits at startup | Resume the cluster in Atlas, then redeploy or restart |
| Gmail connection 7 days old | 403, Gmail shown as disconnected | Tester clicks **Connect Gmail** again (§6) |
| OpenAI hard limit reached | Generation fails | Raise the limit or wait for the monthly reset (§7) |
| `DATA_ENCRYPTION_KEY_BASE64` changed by mistake | Stored Google tokens can no longer be decrypted, so Gmail calls fail | Restore the previous key; otherwise every tester reconnects Gmail |
| `JWT_*_SECRET` changed | Every Draftly session ends | Users sign in again |

---

## 10. Post-deployment smoke tests

Run these manually in a normal browser with DevTools open.
- Use **controlled accounts only**: a Gmail test user you own, plus a second mailbox you own
  to send it a test email.
- **No real email is sent by automated checks.** The send step (item 9) is done by you, by
  hand, to your own second mailbox.

| # | Check | How | Pass |
|---|---|---|---|
| 1 | HTTPS app loads | Open `http://<service>.onrender.com/` | Redirected to HTTPS; the login page renders with Roboto and icons |
| 2 | Security headers on app routes | `curl -sI https://<host>/`, `/dashboard`, `/index.html`, a `main-*.js` | CSP (same value as `security-headers.conf`), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; `Cache-Control: no-cache` on `/` and `/index.html`, `immutable` on hashed files |
| 3 | API through the same origin | `curl -si https://<host>/api/drafts` | `401` with JSON `{"error":…}` (from Express, so the proxy works); the DevTools Network tab shows only same-origin `/api/...` requests |
| 4 | No CSP violations | Console while using every page | No `Refused to …` messages from the app (browser-extension messages can be ignored, as in R2) |
| 5 | Registration and login | Register a new account, log out, log in; 5 wrong passwords then return 429 | Works; after the limiter test, wait 15 minutes, or check from another IP that others are not blocked (this also validates `TRUST_PROXY`) |
| 6 | Google OAuth connect and callback | **Connect Gmail** → Google warning screen → consent | Back on `/dashboard`, Gmail shown as connected. Cancel once on Google's screen: the dashboard shows the "access denied" message. |
| 7 | Inbox search and pagination | Search `from:<your second mailbox>`, toggle **Unread only**, Next/Previous | Results match Gmail; paging works |
| 8 | Draft generation, thread context, recipients | Open the test email, generate in two tones | The draft refers to the thread content; the header shows **To** = the sender (or its `Reply-To`); Reply all shows Cc only when there are other recipients |
| 9 | Edit, approve, reject, send | Edit and save; approve (a Gmail draft appears in Gmail → Drafts); reject a second draft; send the approved one **to your own second mailbox** | Status changes to `SENT`; the reply arrives in the second mailbox in the same thread; the Activity page lists each action |
| 10 | Disconnect and reconnect Gmail | **Disconnect Gmail**, then **Connect Gmail** | The grant is revoked at Google (it disappears from Google Account → Third-party connections); reconnect works and earlier drafts are still listed |
| 11 | Persistence across restart and redeploy | Render → **Manual Deploy** (or restart), then sign in again | Account, drafts and activity are unchanged; Gmail is still connected |
| 12 | Logs contain no secrets | Search the Render logs for `ya29.`, `1//`, `sk-`, `eyJ`, `refresh_token`, `client_secret`, `code=`, `state=` and the Atlas password | No matches. OAuth `code`/`state` and search queries appear as redacted. Also search once after an expired or revoked Gmail grant (item 10 or a 7-day expiry): that error path logs the Google client's error object, whose request details gaxios redacts only in part. |
| 13 | Cold start | Leave the service idle for more than 15 minutes, then load the app | The first load takes about a minute; then everything works |
| 14 | OpenAI limit (optional) | Temporarily set a very low project limit | Generation fails cleanly; no draft is saved; restore the limit |

---

## 11. Priorities

### P1: before sharing the demo URL

1. Hosting per §2 (option A after approving §2.3, or option B), served over HTTPS.
2. Atlas set up per §4: dedicated user, restricted network access, `mongodb+srv` with TLS.
3. Environment variables per §5, with fresh secrets and `TRUST_PROXY` measured.
4. Google Testing mode, test users and the HTTPS redirect URI per §6.
5. OpenAI: a dedicated project with a hard spend limit and alerts, per §7.
6. Smoke tests in §10 pass.

### P2: before more than a few invited testers

These are kept at P2. With a few known testers they are acceptable risks, not reasons to delay
the demo.

- **Server-side refresh tokens** (P-1): stored, rotated, with reuse detection and a logout
  that revokes them.
  - Risk today: a refresh token copied from a tester's browser can be renewed indefinitely,
    and logging out does not stop it.
  - It stops only when `JWT_REFRESH_SECRET` changes, which ends all sessions, or the user is
    deleted.
- **Tokens out of `localStorage`** (P-2), into `HttpOnly`, `Secure`, `SameSite` cookies with
  CSRF protection.
  - Risk today: script running in the page could read the tokens.
  - That is unlikely: the CSP allows only same-origin scripts, and email HTML is sanitized.
    But it is not impossible.
- **Shared rate limiting** (P-6): limits survive restarts, work across instances, and get
  the correct client IP on every path.
  - Risk today: the limits reset on every spin-down or restart.
  - In option B the login limiter can be weakened, because the backend has two entry paths
    with different proxy hop counts (§5.2).
- **OAuth `state` bound to the browser** (S5).
  - Risk today: a tester could be tricked into finishing a Gmail connection that an attacker
    started, which links the attacker's Gmail to the tester's Draftly account.
  - The attacker gains nothing from the victim's Gmail; the confusion is about whose mailbox
    is connected. Low impact.

### P3: real product / production

Kept at P3 and not part of this task:

- Google OAuth verification and the restricted-scope security assessment (CASA, yearly),
  required to leave Testing mode for public users (§6).
- Automated database backups (not free on Atlas free clusters; §4.6).
- Monitoring, alerting and log shipping (P-7).
- Recovery of a send that Gmail accepted but MongoDB never recorded (P-8).
- Sandboxed-iframe email rendering as extra defence in depth.
- Express 5 async error-handling refactor (A8).
- Full Angular signals / `OnPush` conversion.

The accepted MVP limitations in [PLAN.md §6.2](PLAN.md#62-accepted-limitations) stay as they are.

---

## 12. Provider facts (checked 2026-11-13)

Re-check each one before relying on it. "Not stated" means the official page did not say.

| Provider | Fact | Source |
|---|---|---|
| Render | Free web service spins down after 15 minutes without inbound traffic; spin-up "about one minute" | render.com/docs/free |
| Render | 750 free instance hours per workspace per month; free services suspended when exceeded | render.com/docs/free |
| Render | Ephemeral filesystem; no persistent disks, SSH or scaling on free; "might restart a Free web service at any time"; free web services cannot receive private-network traffic | render.com/docs/free, /docs/private-network |
| Render | Must bind `0.0.0.0`; `PORT` defaults to 10000; only one HTTP port is routed per service | render.com/docs/web-services |
| Render | TLS terminated at Render's load balancer; HTTP redirected to HTTPS | render.com/docs/web-services, /docs/tls |
| Render | Forwarded headers (`X-Forwarded-For`), proxy hop count, maximum request duration, free instance RAM/CPU: **not stated** | — |
| Render | Static-site rewrites may point to "a full, publicly accessible URL"; rules apply only when no file exists at the path; method/body forwarding and timeout **not stated** | render.com/docs/redirects-rewrites |
| Render | Static-site headers set per path in the dashboard, values "sent as-is"; CSP and rewritten responses **not stated** | render.com/docs/static-site-headers |
| Render | Outbound IP ranges per region, shown under the service's Connect → Outbound; shared by all services in the region | render.com/docs/outbound-ip-addresses |
| Render | HTTP health check: 2xx/3xx within 5 seconds | render.com/docs/health-checks |
| Vercel | Hobby: "only … for your personal or non-commercial use" | vercel.com/legal/terms §4 (updated 2026-10-19) |
| Vercel | Hobby function duration 300 s default and maximum (Fluid compute) | vercel.com/docs/functions/configuring-functions/duration |
| Vercel | External rewrites supported; proxied request timeout 120 s (`ROUTER_EXTERNAL_TARGET_ERROR`) | vercel.com/docs/rewrites, /docs/limits |
| MongoDB Atlas | Free cluster: 0.5 GB storage, 500 connections, 100 ops/s, 10 GB in/out per 7 days; paused after 30 days with zero connections | mongodb.com/docs/atlas/reference/free-shared-limitations |
| MongoDB Atlas | Authentication required ("You must create database users"); TLS required | mongodb.com/docs/atlas/setup-cluster-security |
| MongoDB Atlas | IP access list only; no private endpoints or peering on free clusters; temporary entries up to 7 days | mongodb.com/docs/atlas/security/ip-access-list, free-shared-limitations |
| MongoDB Atlas | Free cluster backups: optional paid subscription in private preview ($0.10 per day, at most $3 a month), no on-demand snapshots | mongodb.com/docs/atlas/backup/cloud-backup/free-cluster-backup |
| Google | Testing status: up to 100 test users | support.google.com/cloud/answer/15549945 |
| Google | Testing + External: refresh token expires in 7 days unless only name/email/profile scopes are requested | developers.google.com/identity/protocols/oauth2#expiration |
| Google | `gmail.readonly`, `gmail.modify` restricted; `gmail.send` sensitive | developers.google.com/workspace/gmail/api/auth/scopes |
| Google | Restricted scopes need verification and, for server-side access, a yearly security assessment; exceptions for personal use and testing | developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification |
| Google | Unverified-app user cap: 100 users for the project's lifetime, cannot be reset | support.google.com/cloud/answer/15549945 |
| Google | Redirect URIs: HTTPS (except localhost), exact match including trailing slash | developers.google.com/identity/protocols/oauth2/web-server |
| Public Suffix List | `onrender.com` and `vercel.app` listed (version 2026-11-11) | publicsuffix.org/list/public_suffix_list.dat |
| OpenAI | Project monthly spend limit with **Enforce a hard limit** → 429 `project_spend_limit_exceeded`; "Enforcement is not instantaneous"; spend alerts "do not enforce a cap" | developers.openai.com/api/docs/guides/spend-limits |
| OpenAI | The help-center articles on projects and usage limits could not be fetched (HTTP 403) | — |
