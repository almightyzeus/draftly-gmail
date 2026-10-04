# Draftly frontend

Angular 21 single-page app for Draftly (standalone components, lazy-loaded routes, Angular Material 21). See the [project README](../README.md) for the full setup, API, and Docker instructions.

Requires Node.js ≥ 20.19 (the repository pins 20.19.5 in `.nvmrc`; run `nvm use`).

## Development server

```bash
npm install
npm start
```

Open http://localhost:4200. `npm start` runs `ng serve` with `proxy.conf.json`, which forwards `/api` to the backend on http://localhost:3000.

## Build

```bash
npm run build
```

Output goes to `dist/frontend/browser`. In Docker, nginx serves this folder and proxies `/api` to the backend (see `nginx.conf` and `Dockerfile`).

## Tests

Unit tests use Vitest:

```bash
npm test
npm run test:coverage
```

Tests live in `tests/*.vitest.ts`.

## Structure

```text
src/
  styles.css      # global design tokens and shared layout/state styles
  app/
    app.routes.ts # lazy-loaded routes
    pages/        # login, register, dashboard (Inbox/Drafts), email detail, draft detail
    services/     # API clients, auth service, interceptor, guard
    shared/       # top bar, confirm dialog, formatting helpers
```
