# Globular Admin

**Operator UI, reusable web components, and TypeScript SDK for the Globular platform.**

`globular-admin` is the frontend workspace for operating a Globular cluster from the browser today, with a future path to desktop packaging via Tauri. It contains:

- the **admin console** used to inspect and manage clusters
- the **media web app** built on the same platform packages
- a **TypeScript SDK** for talking to Globular services from web apps
- a **reusable component library** for building Globular-native interfaces
- small developer docs for app scaffolding and lifecycle concepts

This repository is the **UI/application layer** of the Globular project.
The backend and control-plane services live in [`globulario/services`](https://github.com/globulario/services), while installable releases for Globular are published from that repository.

## Repository role in the Globular project

Globular is split across a few focused repositories:

- **[`Globular`](https://github.com/globulario/Globular)** - top-level platform entry point, project overview, gateway/xDS shell
- **[`services`](https://github.com/globulario/services)** - core backend services, control plane, docs, and installable releases
- **[`globular-admin`](https://github.com/globulario/globular-admin)** - admin UI, media app, reusable frontend packages, TypeScript SDK
- **[`globular-quickstart`](https://github.com/globulario/globular-quickstart)** - Docker-based simulation and validation environment
- **[`globular-installer`](https://github.com/globulario/globular-installer)** - installer/bootstrap implementation used by packaged install flows

If you want to **run Globular**, start from the releases published in `services`.
If you want to **operate it from the browser or build frontend apps on top of it**, this repository is the right place.

## What lives in this repository

### Apps

#### [`apps/web`](apps/web/README.md)
The main **admin console** for Globular clusters.

It includes pages and widgets for:

- cluster overview, nodes, peers, join flow, topology, reconciliation, workflows, incidents
- repository browsing, audit, installed packages, install policy, trusted publishers, namespaces, package detail
- infrastructure views for control plane, DNS, networking, observability, storage
- security views for certificates, CORS, secrets, and policy-related operations
- RBAC management for accounts, groups, organizations, and roles
- service catalog, service instances, and service details
- observability views for events, logs, and metrics
- AI/operations views including diagnostics, backups, and AI console pages

#### [`apps/media`](apps/media/README.md)
A separate **media-focused web application** built on the same frontend stack.

It contains pages for:

- media search
- watching/playback
- settings
- about
- login

This repo therefore does not just host an admin shell. It is also the beginning of the **application layer** that can run on Globular.

### Packages

#### [`packages/sdk`](packages/sdk/README.md)
A **TypeScript SDK** for browser-based Globular applications.

It exposes client code for multiple service domains, including:

- authentication and session helpers
- cluster and cluster-doctor access
- repository operations
- RBAC and applications
- DNS, events, logs, persistence, notifications
- metrics and Prometheus helpers
- media/blog/title/conversation APIs
- workflow and backup-related clients
- shared RPC/core helpers

The SDK depends on the generated web client artifacts from `services/typescript/dist`.

#### [`packages/components`](packages/components/README.md)
A **reusable UI/component library** for Globular apps.

It includes building blocks such as:

- application layout
- tables, lists, menus, dialogs, split views, wizards
- file explorer, uploader, navigation, preview helpers
- permission and sharing managers
- markdown rendering
- notification editors and panels

These components are designed to be shared across the admin console and application UIs.

### Docs

Current docs in this repository are lightweight but useful:

- `docs/new-app-guide.md` - how to scaffold a new Globular web application in this workspace
- `docs/service-lifecycle.md` - declarative service lifecycle model and state concepts

## Workspace structure

```text
globular-admin/
├── apps/
│   ├── web/              # Main admin console
│   └── media/            # Media-focused web app
├── packages/
│   ├── sdk/              # TypeScript SDK for Globular browser apps
│   ├── components/       # Reusable UI components
│   └── ...               # Other shared workspace packages
├── docs/                 # Frontend/developer docs for this workspace
├── scripts/              # Workspace scripts
├── pnpm-workspace.yaml   # Workspace definition
└── package.json          # Workspace/package metadata
```

## Tech stack

This workspace is built around:

- **TypeScript**
- **Vite** for app development and bundling
- **pnpm workspaces** for monorepo management
- **framework-light custom components** rather than a heavy SPA framework dependency
- **Globular TypeScript clients** generated from the backend protobuf/gRPC contracts

The current direction is:

- **browser-first SPA today**
- **Tauri desktop wrapper later**

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+
- access to the generated client artifacts from `services/typescript/dist`

### Install dependencies

```bash
pnpm install
```

### Run the admin console

```bash
pnpm --filter @globular/admin-web dev
```

### Run the media app

```bash
pnpm --filter @globular/media-web dev
```

### Build the workspace packages

```bash
pnpm build
```

### Build a specific app

```bash
pnpm --filter @globular/admin-web build
pnpm --filter @globular/media-web build
```

### Preview a built app

```bash
pnpm --filter @globular/admin-web preview
pnpm --filter @globular/media-web preview
```

## Building new apps in this workspace

Use the guide in [`docs/new-app-guide.md`](docs/new-app-guide.md).

The intended model is:

1. use `@globular/sdk` for service access
2. use `@globular/components` for shared UI primitives
3. add app-specific pages under `apps/<your-app>`
4. proxy required gRPC-Web/service endpoints through Vite during development

This keeps new apps aligned with the rest of the Globular frontend ecosystem.

## Relationship to the backend

This repository does **not** contain the Globular control plane itself.
It consumes and presents it.

The backend platform lives in [`globulario/services`](https://github.com/globulario/services), including:

- cluster controller
- node agent
- workflow engine
- repository
- authentication
- RBAC
- DNS
- monitoring
- AI services
- package and service contracts

The frontend workspace here sits on top of those APIs and packages them into operator-facing and user-facing applications.

## Installable Globular releases

If you are looking to **install Globular**, use the packaged releases published from the services repository:

- **Releases:** <https://github.com/globulario/services/releases>

Example Linux install flow:

```bash
VERSION="1.0.56"

curl -LO "https://github.com/globulario/services/releases/download/v${VERSION}/globular-${VERSION}-linux-amd64.tar.gz"
curl -LO "https://github.com/globulario/services/releases/download/v${VERSION}/globular-${VERSION}-linux-amd64.tar.gz.sha256"
/usr/bin/sha256sum -c "globular-${VERSION}-linux-amd64.tar.gz.sha256"

tar xzf "globular-${VERSION}-linux-amd64.tar.gz"
cd "globular-${VERSION}-linux-amd64"
sudo bash install.sh
```

## Why this repository matters

`globular-admin` is where Globular starts becoming more than backend infrastructure.
It is the layer where operators and end users actually touch the system:

- manage cluster state
- inspect workflows and incidents
- browse packages and services
- operate security and RBAC
- build real applications on top of the platform

In that sense, this repository is both:

- the **official admin/UI surface** for Globular
- the **foundation for browser and desktop applications** built on the platform

## License

See [LICENSE](LICENSE) for details.
