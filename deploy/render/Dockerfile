# One container for a hosted demo (DEPLOYMENT.md, option A): nginx serves the
# Angular app and proxies /api to the backend in the same container, so the app
# keeps its same-origin /api calls and CSP. Build from the repository root:
#   docker build -f deploy/render/Dockerfile .
# Docker Compose (docker-compose.yml) keeps using backend/Dockerfile and
# frontend/Dockerfile; this file does not change the local setup.

# Backend build: full dependency tree, exact versions from the lockfile.
FROM node:24-alpine AS backend-build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Frontend build, as in frontend/Dockerfile.
FROM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Runtime: Node 24 plus nginx, both running as the unprivileged "node" user.
FROM node:24-alpine

RUN apk add --no-cache nginx

WORKDIR /app

ENV NODE_ENV=production

COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=backend-build /app/dist ./dist

COPY --from=frontend-build /app/dist/frontend/browser /usr/share/nginx/html
COPY frontend/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/render/nginx.conf /etc/nginx/draftly.conf.template
COPY deploy/render/start.sh /usr/local/bin/draftly-start

USER node

# nginx listens on $PORT (Render's default is 10000); the backend on 3000 inside
# the container only.
EXPOSE 10000

CMD ["/bin/sh", "/usr/local/bin/draftly-start"]
