// router.ts
type RouteHandler = () => HTMLElement

// --- Import page components ---
import './pages/login'
import './pages/medias_search'
import './pages/medias_settings'
import './pages/medias_watching'
// ------------------------------

// --- Auth helpers (tiny & framework-agnostic) ---
function getToken(): string | null {
  try { return sessionStorage.getItem('__globular_token__') } catch { return null }
}

function decodeJwtPayload(token: string): any | null {
  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64).split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function isTokenFresh(token: string | null): boolean {
  if (!token) return false
  const p = decodeJwtPayload(token)
  if (!p) return false
  if (typeof p.exp !== 'number') return true // if no exp, assume usable; server still enforces
  const now = Math.floor(Date.now() / 1000)
  return p.exp > now
}

function hasToken(): boolean {
  return isTokenFresh(getToken())
}

// Which routes can be seen without being authenticated
const PUBLIC_ROUTES = new Set<string>(['#/login'])

const DEFAULT_ROUTE = '#/media/search'
const LOGIN_ROUTE = '#/login'

const routes: Record<string, RouteHandler> = {
  '#/login': () => {
    const el = document.createElement('page-login')
    el.setAttribute('app-name', 'Globular Media')
    el.setAttribute('logo-src', './img/logo.png')
    el.setAttribute('version', 'v0.9.0')
    return el
  },

  '#/media/search':   () => document.createElement('page-media-search'),
  '#/media/settings': () => document.createElement('page-media-settings'),
  '#/media/watching': () => document.createElement('page-media-watching'),
}

function getRouteHandler(route: string): RouteHandler {
  return routes[route] ?? routes[DEFAULT_ROUTE]
}

function normalizeHash(raw?: string): string {
  if (!raw) return ''
  return raw.startsWith('#/') ? raw : `#/${raw.replace(/^\/+/, '')}`
}

function resolveRoute(raw?: string): string {
  const requested = normalizeHash(raw || window.location.hash || DEFAULT_ROUTE)

  // Public routes allowed always
  if (PUBLIC_ROUTES.has(requested)) return requested

  // Non-public: require fresh token only (any logged-in user can access media)
  if (hasToken()) return requested

  // Otherwise force login
  return LOGIN_ROUTE
}

export function mountRoute(route?: string) {
  const target = document.getElementById('app')!
  target.innerHTML = ''

  const resolved = resolveRoute(route)
  const handler = getRouteHandler(resolved)
  target.appendChild(handler())

  // Reflect the resolved route in the URL bar
  if (window.location.hash !== resolved) {
    history.replaceState(null, '', resolved)
  }
}

// Small navigation helper for other modules (e.g., login.ts)
export function navigateTo(path: string) {
  const dest = resolveRoute(path)
  if (window.location.hash !== dest) {
    history.replaceState(null, '', dest)
  }
  mountRoute(dest)
}

export function startRouter() {
  // First render: go to login if unauthenticated
  const initial = resolveRoute(window.location.hash || DEFAULT_ROUTE)
  if (window.location.hash !== initial) {
    history.replaceState(null, '', initial)
  }
  mountRoute(initial)

  // Listen to hash changes
  window.addEventListener('hashchange', () => {
    mountRoute(window.location.hash)
  })

  // Sidebar event delegation (supports nested custom elements via composedPath)
  document.addEventListener('click', (ev) => {
    const path = (ev.composedPath && ev.composedPath()) as Array<EventTarget & { tagName?: string, getAttribute?: (n: string) => string | null }> || []
    const item = path.find((el) => el?.tagName?.toLowerCase?.() === 'globular-sidebar-menu-item')
    if (!item) return
    const route = item.getAttribute && item.getAttribute('route')
    if (route) {
      const dest = resolveRoute(route)
      if (window.location.hash !== dest) {
        history.pushState(null, '', dest)
        mountRoute(dest)
      } else {
        mountRoute(dest) // ensure rerender if same hash
      }
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, { capture: true })
}
