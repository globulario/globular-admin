# @globular/components

Shared custom elements and UI building blocks for Globular web apps.

`@globular/components` is the workspace package that registers the reusable browser-side components used across the Globular admin and media applications. It is not a framework in itself. Instead, it provides custom elements, UI primitives, explorer widgets, sharing tools, and permission-management interfaces that other apps can assemble.

## What this package contains

The current source tree shows several major UI groups:

### Layout and generic UI
- application layout shell
- split views
- dockbar
- dialogs
- menus
- wizards
- moveable / resizable helpers
- lists, tables, links, autocomplete, images, markdown
- notifications panel and notification editor

### File explorer
- file explorer shell
- icon/list views
- file navigation and path navigation
- file uploading
- media cache helpers
- file reading
- search document helpers
- disk space manager
- selection bar and tray-style interactions

### Permissions and sharing
- permission manager
- permission panels/viewers/utils
- resources permission manager
- sharing panel
- share menu / wizard
- subject/resource sharing helpers

## Package role in the Globular workspace

This package is the reusable UI layer used by:

- `@globular/admin-web`
- `@globular/media-web`
- any future Globular web or Tauri apps

It depends on `@globular/sdk` for data/service access and on `@globular/media` for media-related UI behaviors.

## Import model

Importing the package root registers its custom elements as side effects:

```ts
import '@globular/components'
```

The root barrel currently registers major UI modules such as layout elements, file explorer, permission manager, sharing panels, notifications, tables, markdown, and more.

Deep imports are also supported through the package exports pattern.

## Directory overview

```text
src/
├── index.ts                   # barrel file / side-effect registration
├── fileExplorer/              # file browsing components
├── permissionManager/         # RBAC and permissions UI
├── share/                     # sharing UI and flows
├── notification/              # notifications UI
├── applicationLayout.js       # shell/layout components
├── dialog.js, menu.js, ...    # generic UI primitives
└── styles.css / plyr.css      # shared styles
```

## Development

Build the package:

```bash
pnpm --filter @globular/components build
```

Clean build output:

```bash
pnpm --filter @globular/components clean
```

Or from this package directory directly:

```bash
pnpm build
pnpm clean
```

## Intended use

Use this package when you want the Globular UI vocabulary without rewriting the same browser widgets for every app.

It is especially useful for:
- admin/operator tools
- browser-based file management
- permission-aware interfaces
- sharing/resource management flows
- custom-element based apps that avoid a heavy UI framework

## Status

This package is already more than a few generic widgets. It is effectively the shared front-end component system for the Globular application layer.
