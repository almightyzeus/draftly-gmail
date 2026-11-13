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

Output goes to `dist/frontend/browser`. In Docker, nginx serves this folder and proxies `/api` to the backend (see `nginx.conf` and `Dockerfile`). `nginx.conf` proxies to the Compose service name (`http://backend:3000`), so the image works only inside Docker Compose. The app calls `/api` on its own origin, and the CSP allows `connect-src 'self'`, so any other host must serve the API from the same origin. See [DEPLOYMENT.md](../DEPLOYMENT.md).

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
  styles.css      # design tokens (--dr-* colours), used through Tailwind colour names
  tailwind.css    # Tailwind utilities (no base reset), colours mapped to the theme
  app/
    app.routes.ts # lazy-loaded routes
    pages/        # login, register, dashboard (Inbox/Drafts), email detail, draft detail, preferences, activity
    services/     # API clients, auth service, interceptor, guard
    shared/       # top bar, confirm dialog, busy overlay, loading/empty/error state, status badge, formatting helpers
```

## Theme and colours

`src/theme.scss` builds the Angular Material theme from Sass: the classic indigo/pink Material 2 theme, identical to the prebuilt `indigo-pink.css` it replaced (verified by comparing the compiled CSS). It also defines Material's system colour variables (`--mat-sys-primary`, `--mat-sys-on-surface`, `--mat-sys-outline`, `--mat-sys-surface`, …). Custom styles use those variables, or the `--dr-*` tokens in `styles.css` for colours Material has no equivalent for (page background, status badges, success/warning), instead of hard-coded colour values.

Fonts are self-hosted from npm packages, pinned exactly and listed first in `angular.json` "styles": Roboto as a variable font (`@fontsource-variable/roboto`, family `'Roboto Variable'`, the same file Google Fonts serves) and the Material Icons font with its `.material-icons` class (`material-icons`). The build and the running app make no requests to Google Fonts, so a Docker build needs no font download and the CSP allows fonts from `'self'` only.

## Tailwind CSS

Layout and spacing use Tailwind CSS 4 utility classes in the templates (`flex gap-4 p-4`); components come from Angular Material. Set up in `src/tailwind.css` (loaded last in `angular.json`) and `.postcssrc.json`, versions pinned exactly:

- **No preflight.** Tailwind's base reset is left out, so it cannot restyle Material components or the email HTML shown on the email page.
- **Unlayered utilities.** Material's CSS is not in a cascade layer, and unlayered CSS always beats layered CSS, so the utilities are imported without a layer; otherwise they could never override a Material default.
- **Overriding Material.** Material's component styles load after the utilities, so on equal specificity Material wins. Set a Material token instead where one exists (`[--mat-card-title-text-size:24px]`), or add Tailwind's important suffix (`table-fixed!`, `text-right!`).
- **One colour source.** Tailwind's default palette is removed. The available colours are `primary`, `on-primary`, `surface`, `on-surface`, `outline` (Material system variables) and `page`, `muted`, `danger`, `success`, `warning`, `neutral`, `link`, `subtle` and the light tints `danger-subtle`, `success-subtle`, `warning-subtle`, `primary-subtle`, `neutral-subtle` (`--dr-*` tokens), plus `white`/`black`: e.g. `bg-primary`, `text-muted`, `border-outline`. `rounded-dr` is the app's corner radius.
- **Phone layout.** The `phone:` variant applies up to and including 600px wide (`phone:hidden`, `phone:px-2`), the same breakpoint as the app's CSS. Tailwind's `max-[600px]:` would stop just below 600px.
- **Templates only.** Tailwind scans `src/app/**/*.html` and `src/index.html` for class names, so utility classes belong in templates, not in TypeScript strings.

## Component conventions

Every component keeps its markup and styles in separate files next to its class: `name.component.ts`, `name.component.html` (`templateUrl`) and, when it has styles, `name.component.css` (`styleUrls`). Inline `template:` and `styles:` are not used. Prefer Material components and Tailwind utilities; add a `.css` file only for what they cannot express. A styled pattern repeated across pages becomes a small shared component (`<app-state>`, `<app-status-badge>`), not a global CSS class. `tests/conventions.vitest.ts` enforces this: `npm test` fails if a component has an inline template or styles, or points to a file that does not exist.
