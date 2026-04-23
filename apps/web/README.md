# @globular/admin-web

Web-based administration console for Globular.

`@globular/admin-web` is the operator-facing SPA used to inspect and manage a Globular cluster. It is built with Vite and TypeScript, uses the workspace SDK and component packages, and loads most screens lazily by route for a fast shell-first experience.

## What this package contains

This app is the main admin surface for cluster operators. Based on the current source tree, it includes screens for:

- dashboard and login
- cluster operations: nodes, topology, workflows, incidents, join, peers, reconciliation, apps, DNS, services
- repository operations: catalog/market, installed packages, namespaces, trusted publishers, install policy, audit, package detail
- security and RBAC: certificates, secrets, CORS, policies, accounts, groups, organizations, roles
- infrastructure views: overview, storage, DNS, networking, control plane, observability
- observability: metrics, logs, events
- workflow tooling: definitions, detail, YAML parser
- admin tools: diagnostics, backups, AI console
- media-related views reused from the media app surface

The router is framework-free and route-based. Each page is loaded on demand with dynamic imports, which keeps the initial shell small and splits the app into page-level chunks.

## Package role in the Globular workspace

- `Globular` repo: top-level platform entry point and umbrella project
- `services` repo: backend services, control plane, protobuf contracts, installable releases
- `@globular/sdk`: browser/client SDK used by this app
- `@globular/components`: shared web components and UI primitives used by this app
- `@globular/media`: media/domain helpers reused inside the admin UI

This package is the cluster management frontend, not the backend control plane itself.

## Directory overview

```text
src/
├── main.ts                 # app bootstrap
├── router.ts               # lazy route loader + auth gate
├── pages/                  # route-level screens
├── widgets/                # reusable admin widgets
├── utils/                  # small UI/util helpers
└── styles/                 # app styles
```

## Development

From the workspace root:

```bash
pnpm --filter @globular/admin-web dev
```

Build:

```bash
pnpm --filter @globular/admin-web build
```

Preview the production build:

```bash
pnpm --filter @globular/admin-web preview
```

Or from this package directory directly:

```bash
pnpm dev
pnpm build
pnpm preview
```

## Dependencies

This package depends primarily on:

- `@globular/sdk` for API access and service/domain helpers
- `@globular/components` for shared custom elements and UI building blocks
- `@globular/media` and `@globular/ui` for reused app/domain UI logic
- `uplot` for metrics visualizations
- `js-yaml` for workflow/config related views

## Authentication model

The current router checks for a session token in `sessionStorage` and gates most routes behind authentication. The login screen is public; the rest of the app is protected. Some routes also appear designed for elevated administrative access.

## Output

The app builds as a static SPA via Vite. It is suitable for serving through the Globular gateway/web layer today, and can later be wrapped into Tauri for a desktop operator console.

## Status

This package already looks like a serious cluster admin shell, not just a placeholder. The source tree shows real operational coverage across cluster, repository, security, infrastructure, and observability domains.
