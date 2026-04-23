# @globular/sdk

Browser/client SDK for Globular web applications.

`@globular/sdk` is the TypeScript access layer used by the Globular web apps. It wraps service access, auth/session helpers, repository and RBAC operations, media helpers, metrics utilities, cluster helpers, and selected proto type re-exports into a package that frontend code can consume directly.

## What this package contains

The current source tree is organized around several domains:

### Core
- auth and session helpers
- endpoint and service resolution helpers
- RPC helpers
- network and CORS helpers
- domain helpers
- error utilities

### Service-facing modules
- cluster
- cluster doctor
- workflow
- AI executor
- backup client
- DNS
- repository
- persistence
- search
- notifications

### RBAC and identity
- accounts
- groups
- organizations
- roles
- permissions
- applications
- disk space helpers

### CMS and content helpers
- files
- file cache
- torrent helpers
- readDir worker support

### Media and app helpers
- media
- title
- blog
- conversation
- `apps/media` re-exports for media-focused consumers

### Observability utilities
- event client access and event queries
- log queries
- stats and metric normalization
- Prometheus helpers
- admin metrics helpers

### UI helpers
- notification helpers and small UI exports

## Public exports

The package currently exposes:

- root: `@globular/sdk`
- core: `@globular/sdk/core`
- services: `@globular/sdk/services`
- media app helpers: `@globular/sdk/apps/media`
- UI helpers: `@globular/sdk/ui`

It also re-exports selected protobuf namespaces such as RBAC, resource, title, and auth types from its own `proto` surface.

## Package role in the Globular workspace

This package is the glue between the frontend apps and the backend services in the `services` repository.

It is consumed by:
- `@globular/admin-web`
- `@globular/media-web`
- `@globular/components`
- any future browser/Tauri clients for Globular

## Development

Build the package:

```bash
pnpm --filter @globular/sdk build
```

Run tests:

```bash
pnpm --filter @globular/sdk test
```

Watch tests:

```bash
pnpm --filter @globular/sdk test:watch
```

Or from this package directory directly:

```bash
pnpm build
pnpm test
pnpm test:watch
```

## Example

```ts
import { displaySuccess, getEventClient } from '@globular/sdk'
import * as services from '@globular/sdk/services'
import * as media from '@globular/sdk/apps/media'
```

## Notes

- The package currently depends on `globular-web-client` built from the `services/typescript/dist` output.
- The package is configured to publish built artifacts from `dist/`.
- Several root exports exist partly for backward compatibility, which helps keep existing apps working while the API surface evolves.

## Status

This is not just a thin API wrapper. It already acts as the main client integration layer for Globular web applications, combining transport helpers, service-domain APIs, metrics/log/event utilities, and media/app conveniences in one place.
