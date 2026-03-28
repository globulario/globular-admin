// router.ts — lazy route-based code-splitting
type RouteHandler = () => Promise<HTMLElement> | HTMLElement

// --- Auth helpers (tiny & framework-agnostic) ---
function hasToken(): boolean {
  try { return !!sessionStorage.getItem('__globular_token__') } catch { return false }
}

// Which routes can be seen without being authenticated
const PUBLIC_ROUTES = new Set<string>(['#/login'])

const DEFAULT_ROUTE = '#/media/watching'
const LOGIN_ROUTE = '#/login'

// --- Lazy loader ---
const moduleCache = new Map<string, Promise<any>>()

function lazy(loader: () => Promise<any>, tagName: string): RouteHandler {
  return async () => {
    if (!moduleCache.has(tagName)) {
      moduleCache.set(tagName, loader())
    }
    await moduleCache.get(tagName)
    return document.createElement(tagName)
  }
}

const routes: Record<string, RouteHandler> = {
  '#/login': async () => {
    await import('./pages/login')
    const el = document.createElement('page-login')
    el.setAttribute('app-name', 'Globular Media')
    el.setAttribute('logo-src', './img/logo.png')
    el.setAttribute('version', 'v0.9.0')
    return el
  },

  '#/media/search':   lazy(() => import('./pages/medias_search'), 'page-media-search'),
  '#/media/settings': lazy(() => import('./pages/medias_settings'), 'page-media-settings'),
  '#/media/watching': lazy(() => import('./pages/medias_watching'), 'page-media-watching'),
  '#/media/about':    lazy(() => import('./pages/medias_about'), 'page-media-about'),
}

// Routes whose page instances are kept alive between navigations.
const PERSISTENT_ROUTES = new Set([
  '#/media/search',
  '#/media/settings',
  '#/media/watching',
  '#/media/about',
])

const pageCache = new Map<string, HTMLElement>()

export function clearPageCache() {
  pageCache.forEach(el => el.remove())
  pageCache.clear()
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
  if (PUBLIC_ROUTES.has(requested)) return requested
  if (hasToken()) return requested
  return LOGIN_ROUTE
}

export async function mountRoute(route?: string) {
  const target = document.getElementById('app')!
  const resolved = resolveRoute(route)

  if (PERSISTENT_ROUTES.has(resolved)) {
    const cachedEls = new Set(pageCache.values())
    Array.from(target.children).forEach(child => {
      if (!cachedEls.has(child as HTMLElement)) child.remove()
    })

    pageCache.forEach(el => { el.style.display = 'none' })

    let page = pageCache.get(resolved)
    if (!page) {
      page = await getRouteHandler(resolved)()
      target.appendChild(page)
      pageCache.set(resolved, page)
    }
    page.style.display = 'block'
    page.style.height = '100%'
  } else {
    clearPageCache()
    target.innerHTML = ''
    const el = await getRouteHandler(resolved)()
    target.appendChild(el)
  }

  if (window.location.hash !== resolved) {
    history.replaceState(null, '', resolved)
  }
}

export function navigateTo(path: string) {
  const dest = resolveRoute(path)
  if (window.location.hash !== dest) {
    history.replaceState(null, '', dest)
  }
  mountRoute(dest)
}

export function startRouter() {
  const initial = resolveRoute(window.location.hash || DEFAULT_ROUTE)
  if (window.location.hash !== initial) {
    history.replaceState(null, '', initial)
  }
  mountRoute(initial)

  window.addEventListener('hashchange', () => {
    mountRoute(window.location.hash)
  })

  // Sidebar event delegation
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
        mountRoute(dest)
      }
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, { capture: true })
}
