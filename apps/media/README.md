# @globular/media-web

Media-focused web application for Globular.

`@globular/media-web` is a Vite + TypeScript SPA centered on media browsing and playback. It reuses the shared SDK, UI components, and media helpers from the Globular workspace, but presents a much narrower surface than the full admin console.

## What this package contains

Based on the current source tree, this app provides:

- login
- media search
- media watching / playback
- media settings
- about page

Its router is lightweight and framework-free, with lazy route loading and persistent page caching for the main media views.

## Package role in the Globular workspace

- `@globular/admin-web`: full operator/admin console
- `@globular/media-web`: focused media application
- `@globular/sdk`: backend access layer used by this app
- `@globular/components`: shared UI/custom elements
- `@globular/media`: media-specific helpers shared across apps

This package is an end-user style application surface, not the cluster administration frontend.

## Directory overview

```text
src/
├── main.ts           # app bootstrap
├── router.ts         # lazy routing and authenticated navigation
├── pages/            # media pages
└── styles/           # app styles
```

## Development

From the workspace root:

```bash
pnpm --filter @globular/media-web dev
```

Build:

```bash
pnpm --filter @globular/media-web build
```

Preview:

```bash
pnpm --filter @globular/media-web preview
```

Or from this package directory directly:

```bash
pnpm dev
pnpm build
pnpm preview
```

## Routing

The current route map includes:

- `#/login`
- `#/media/search`
- `#/media/settings`
- `#/media/watching`
- `#/media/about`

The router keeps core media pages alive between navigations, which is useful for preserving view state while moving around the app.

## Output

The app builds as a static Vite SPA and is intended to be served inside the broader Globular platform.

## Status

This package is intentionally smaller and more focused than the admin console. It looks like the application-facing media experience that sits alongside the operator-facing admin UI.
