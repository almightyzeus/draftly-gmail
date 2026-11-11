# Draftly frontend

Angular 22 single-page app for Draftly (standalone components, lazy-loaded routes, Angular Material 22). See the [project README](../README.md) for the full setup, API, and Docker instructions.

Requires Node.js 24 LTS (`.nvmrc` holds `24`; run `nvm use`). Angular 22 also runs on Node ≥ 22.22.3 (Node 24 needs ≥ 24.15.0).

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
npm run typecheck:tests   # type-check the suites (Vitest does not)
```

Tests live in `tests/*.vitest.ts`.

## Docker

The image installs dependencies with `npm ci` (exact lockfile versions; Angular packages are pinned exactly), builds the app, and serves it with nginx, which also sets the Content-Security-Policy and other security headers (`security-headers.conf`, included in each app location of `nginx.conf`) and the caching headers (`index.html` revalidated on every load, hashed build files cached for a year). The production build disables critical-CSS inlining, whose inline `onload` handler the CSP would block.

## Structure

```text
src/
  theme.scss      # Angular Material theme (indigo/pink, Material 2 look) and its --mat-sys-* colour variables
  styles.css      # global design tokens and shared layout/state styles
  app/
    app.routes.ts # lazy-loaded routes
    pages/        # login, register, dashboard (Inbox/Drafts), email detail, draft detail, preferences, activity
    services/     # API clients, auth service, interceptor, guard
    shared/       # top bar, confirm dialog, busy overlay, formatting helpers
```

## Theme and colours

`src/theme.scss` builds the Angular Material theme from Sass: the classic indigo/pink Material 2 theme, identical to the prebuilt `indigo-pink.css` it replaced (verified by comparing the compiled CSS). It also defines Material's system colour variables (`--mat-sys-primary`, `--mat-sys-on-surface`, `--mat-sys-outline`, `--mat-sys-surface`, …). Custom styles use those variables, or the `--dr-*` tokens in `styles.css` for colours Material has no equivalent for (page background, status badges, success/warning), instead of hard-coded colour values.

## Component conventions

Every component keeps its markup and styles in separate files next to its class: `name.component.ts`, `name.component.html` (`templateUrl`) and, when it has styles, `name.component.css` (`styleUrls`). Inline `template:` and `styles:` are not used. `tests/conventions.vitest.ts` enforces this: `npm test` fails if a component has an inline template or styles, or points to a file that does not exist.
