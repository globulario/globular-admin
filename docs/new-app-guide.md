# Creating a New Globular App

This guide walks through building a new Globular cluster application from scratch using the shared packages.

## Prerequisites

- Node.js >= 18
- pnpm 9+
- The `services/typescript/dist` proto stubs available (via symlink)

## 1. Scaffold the app

```bash
mkdir -p apps/my-app/src/styles
mkdir -p apps/my-app/public/img
```

## 2. Create `apps/my-app/package.json`

```json
{
  "name": "@globular/my-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4175"
  },
  "dependencies": {
    "@globular/sdk": "workspace:*",
    "@globular/components": "workspace:*",
    "@globular/ui": "workspace:*",
    "@fortawesome/fontawesome-free": "^7.1.0",
    "@polymer/app-layout": "^3.1.0",
    "@polymer/iron-collapse": "^3.0.1",
    "@polymer/iron-icons": "^3.0.1",
    "@polymer/paper-icon-button": "^3.0.2",
    "toastify-js": "^1.12.0"
  },
  "devDependencies": {
    "@globular/build-tools": "workspace:*",
    "typescript": "^5.4.0",
    "vite": "^5.0.0"
  }
}
```

## 3. Create `apps/my-app/vite.config.ts`

```ts
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import {
  fixProtoExternals,
  globularOptimizeDeps,
  globularResolveAlias,
  globularCommonjsInclude,
} from '@globular/build-tools'

const protoDir = path.resolve(__dirname, '../../../services/typescript/dist')
const packagesDir = path.resolve(__dirname, '../../packages')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target = env.VITE_PROXY_TARGET || 'https://www.globular.cloud'

  return {
    plugins: [fixProtoExternals(protoDir)],
    root: '.',
    server: {
      port: 5175,
      open: true,
      proxy: {
        // Add the gRPC service proxies your app needs:
        '/authentication.AuthenticationService': { target, changeOrigin: true, secure: false },
        '/rbac.RbacService': { target, changeOrigin: true, secure: false },
        '/resource.ResourceService': { target, changeOrigin: true, secure: false },
        '/event.EventService': { target, changeOrigin: true, secure: false },
        '/file.FileService': { target, changeOrigin: true, secure: false },
        '/config': { target, changeOrigin: true, secure: false },
      },
    },
    optimizeDeps: { include: globularOptimizeDeps() },
    resolve: { alias: globularResolveAlias(protoDir, packagesDir) },
    build: {
      outDir: 'dist',
      sourcemap: true,
      target: 'es2020',
      commonjsOptions: { include: globularCommonjsInclude() },
    },
  }
})
```

## 4. Create `apps/my-app/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Globular App</title>
</head>
<body>
  <globular-app-layout application-name="My App">

    <globular-sidebar slot="app-side-menu" header-title="Globular">
      <globular-sidebar-menu>
        <globular-sidebar-menu-item text="Home" route="#/home"></globular-sidebar-menu-item>
      </globular-sidebar-menu>
    </globular-sidebar>

    <div slot="app-title">
      <h3 style="margin:0;padding-left:8px;">My App</h3>
    </div>

    <!-- visibility="authenticated" shows for any logged-in user;
         default "sa-only" shows only for the sa account -->
    <user-toolbar slot="contextual-action-bar" visibility="authenticated"></user-toolbar>
    <theme-toggle slot="contextual-action-bar"></theme-toggle>

    <div slot="app-content" id="app"></div>
  </globular-app-layout>

  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

## 5. Create `apps/my-app/src/main.ts`

```ts
// Shared styles (theme tokens + MD3 components + base layout)
import '@globular/ui/styles/theme.css'
import '@globular/ui/styles/components.css'
import './styles/styles.css'

// Web components (app layout, toolbar, toggle)
import '@globular/components/applicationLayout.js'
import '@globular/ui'

// Third-party CSS
import '@fortawesome/fontawesome-free/css/all.min.css'
import 'toastify-js/src/toastify.css'

// Bootstrap
import { initGlobularApp } from '@globular/ui'
import { startRouter, navigateTo } from './router'

initGlobularApp({ onNavigate: navigateTo })
startRouter()
```

## 6. Create `apps/my-app/src/router.ts`

```ts
const routes: Record<string, () => Promise<string>> = {
  '#/home': async () => '<h2>Welcome</h2>',
}

export function navigateTo(hash: string) {
  window.location.hash = hash.startsWith('#') ? hash.slice(1) : hash
}

export function startRouter() {
  const app = document.getElementById('app')!

  async function onRoute() {
    const hash = window.location.hash || '#/home'
    const render = routes[hash]
    if (render) {
      app.innerHTML = await render()
    } else {
      app.innerHTML = '<h2>404</h2>'
    }
  }

  window.addEventListener('hashchange', onRoute)
  onRoute()
}
```

## 7. Create `apps/my-app/src/styles/styles.css`

```css
@import '@globular/ui/styles/base.css';

/* App-specific overrides go here */
```

## 8. Install and run

```bash
pnpm install
pnpm --filter @globular/my-app dev
```

## Package Overview

| Package | Purpose |
|---------|---------|
| `@globular/build-tools` | Shared Vite plugin + config helpers for proto stubs |
| `@globular/ui` | Theme, CSS tokens, widgets (theme-toggle, user-toolbar), bootstrap |
| `@globular/sdk` | gRPC-web clients, auth, session, event hub |
| `@globular/components` | Polymer 3 web components (file explorer, media, search, etc.) |

## Widget Attributes

### `<user-toolbar>`

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| `visibility` | `sa-only`, `authenticated` | `sa-only` | Who can see the toolbar |
| `logout-redirect` | hash route | none | Override post-logout navigation |

### `<theme-toggle>`

No attributes. Reads/writes `localStorage.__theme__`.
