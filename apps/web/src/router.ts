// router.ts — lazy route-based code-splitting
//
// Each page is loaded on-demand via dynamic import().
// Vite automatically creates separate chunks for each route.

type RouteHandler = () => Promise<HTMLElement> | HTMLElement

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
  if (typeof p.exp !== 'number') return true
  const now = Math.floor(Date.now() / 1000)
  return p.exp > now
}

function getUsername(): string | null {
  const t = getToken()
  const p = t ? decodeJwtPayload(t) : null
  let u: string | undefined =
    p?.preferred_username ??
    p?.username ??
    p?.user ??
    p?.name ??
    p?.sub ??
    p?.email

  if (u && typeof u === 'string') {
    if (u.includes('@')) u = u.split('@')[0]
    return u
  }
  try { return localStorage.getItem('current_user') } catch { return null }
}

function hasToken(): boolean {
  return isTokenFresh(getToken())
}

function isSuperAdmin(): boolean {
  const u = getUsername()
  return !!u && u.toLowerCase() === 'sa'
}

// --- Lazy page loader ---
// Caches the import promise so repeated navigation doesn't re-fetch.
const pageCache = new Map<string, Promise<any>>()

function lazy(loader: () => Promise<any>, tagName: string): RouteHandler {
  return async () => {
    if (!pageCache.has(tagName)) {
      pageCache.set(tagName, loader())
    }
    await pageCache.get(tagName)
    return document.createElement(tagName)
  }
}

export function clearPageCache() {
  pageCache.clear()
}

// Which routes can be seen without being authenticated
const PUBLIC_ROUTES = new Set<string>(['#/login'])

const routes: Record<string, RouteHandler> = {
  '#/login': async () => {
    await import('./pages/login')
    const el = document.createElement('page-login')
    el.setAttribute('app-name', 'Globular Admin')
    el.setAttribute('logo-src', './img/logo.png')
    el.setAttribute('version', 'v0.9.0')
    return el
  },

  // Overview
  '#/dashboard': lazy(() => import('./pages/dashboard'), 'page-dashboard'),

  // Cluster
  '#/cluster/nodes':          lazy(() => import('./pages/cluster_nodes'), 'page-cluster-nodes'),
  '#/cluster/reconciliation': lazy(() => import('./pages/cluster_reconciliation'), 'page-cluster-reconciliation'),
  '#/cluster/join':           lazy(() => import('./pages/cluster_join'), 'page-cluster-join'),
  '#/cluster/topology':       lazy(() => import('./pages/cluster_topology'), 'page-cluster-topology'),

  // Services
  '#/services/instances': lazy(() => import('./pages/services_instances'), 'page-services-instances'),
  '#/services/catalog':   lazy(() => import('./pages/services_catalog'), 'page-services-catalog'),

  // Security
  '#/security/certificates':        lazy(() => import('./pages/security_certificates'), 'page-security-certificates'),
  '#/security/secrets':             lazy(() => import('./pages/security_secrets'), 'page-security-secrets'),
  '#/security/cors':                lazy(() => import('./pages/security_cors'), 'page-security-cors'),
  '#/security/rbac/accounts':       lazy(() => import('./pages/rbac_accounts'), 'page-rbac-accounts'),
  '#/security/rbac/organizations':  lazy(() => import('./pages/rbac_orgs'), 'page-rbac-organizations'),
  '#/security/rbac/groups':         lazy(() => import('./pages/rbac_groups'), 'page-rbac-groups'),
  '#/security/rbac/roles':          lazy(() => import('./pages/rbac_roles'), 'page-rbac-roles'),

  // Infrastructure
  '#/infrastructure/overview':      lazy(() => import('./pages/infrastructure_overview'), 'page-infrastructure-overview'),
  '#/infrastructure/storage':       lazy(() => import('./pages/infrastructure_storage'), 'page-infrastructure-storage'),
  '#/infrastructure/dns':           lazy(() => import('./pages/infrastructure_dns'), 'page-infrastructure-dns'),
  '#/infrastructure/networking':    lazy(() => import('./pages/infrastructure_networking'), 'page-infrastructure-networking'),
  '#/infrastructure/control-plane': lazy(() => import('./pages/infrastructure_control_plane'), 'page-infrastructure-control-plane'),
  '#/infrastructure/observability': lazy(() => import('./pages/infrastructure_observability'), 'page-infrastructure-observability'),

  // Observability
  '#/observability/metrics': lazy(() => import('./pages/observability_metrics'), 'page-observability-metrics'),
  '#/observability/logs':    lazy(() => import('./pages/observability_logs'), 'page-observability-logs'),
  '#/observability/events':  lazy(() => import('./pages/observability_events'), 'page-observability-events'),

  // Repository
  '#/repository':                    lazy(() => import('./pages/repo_market'), 'page-repository'),
  '#/repository/catalog':            lazy(() => import('./pages/repo_market'), 'page-repository'),
  '#/repository/namespaces':         lazy(() => import('./pages/repo_namespaces'), 'page-repo-namespaces'),
  '#/repository/trusted-publishers': lazy(() => import('./pages/repo_trusted_publishers'), 'page-repo-trusted-publishers'),
  '#/repository/install-policy':     lazy(() => import('./pages/repo_install_policy'), 'page-repo-install-policy'),
  '#/repository/audit':              lazy(() => import('./pages/repo_audit'), 'page-repo-audit'),
  '#/repository/installed':          lazy(() => import('./pages/repo_installed'), 'page-repo-installed'),

  // Admin Tools
  '#/admin/diagnostics': lazy(() => import('./pages/admin_diagnostics'), 'page-admin-diagnostics'),
  '#/admin/upgrades':    lazy(() => import('./pages/admin_upgrades'), 'page-admin-upgrades'),
  '#/admin/backups':     lazy(() => import('./pages/admin_backups'), 'page-admin-backups'),
}

const SERVICE_DETAIL_PREFIX = '#/services/'
const SERVICE_DETAIL_EXCLUSIONS = new Set<string>([
  '#/services/catalog',
  '#/services/instances',
])

const REPO_PACKAGE_PREFIX = '#/repository/package/'

const DEFAULT_ROUTE = '#/dashboard'
const LOGIN_ROUTE = '#/login'

function createServiceDetailHandler(route: string): RouteHandler | null {
  if (!route.startsWith(SERVICE_DETAIL_PREFIX)) return null
  if (SERVICE_DETAIL_EXCLUSIONS.has(route)) return null
  const raw = route.slice(SERVICE_DETAIL_PREFIX.length)
  if (!raw) return null
  const serviceName = decodeURIComponent(raw)
  return async () => {
    await import('./pages/services_detail')
    const el = document.createElement('page-service-detail')
    el.setAttribute('service-name', serviceName)
    return el
  }
}

function createRepoPackageDetailHandler(route: string): RouteHandler | null {
  if (!route.startsWith(REPO_PACKAGE_PREFIX)) return null
  const raw = route.slice(REPO_PACKAGE_PREFIX.length)
  if (!raw) return null
  const parts = raw.split('/')
  if (parts.length < 2) return null
  const publisher = decodeURIComponent(parts[0])
  const name = decodeURIComponent(parts[1])
  return async () => {
    await import('./pages/repo_package_detail')
    const el = document.createElement('page-repo-package-detail')
    el.setAttribute('publisher', publisher)
    el.setAttribute('pkg-name', name)
    return el
  }
}

function getRouteHandler(route: string): RouteHandler {
  return createServiceDetailHandler(route) ?? createRepoPackageDetailHandler(route) ?? routes[route] ?? routes[DEFAULT_ROUTE]
}

function normalizeHash(raw?: string): string {
  if (!raw) return ''
  return raw.startsWith('#/') ? raw : `#/${raw.replace(/^\/+/, '')}`
}

function resolveRoute(raw?: string): string {
  const requested = normalizeHash(raw || window.location.hash || DEFAULT_ROUTE)

  if (PUBLIC_ROUTES.has(requested)) return requested

  if (hasToken() && isSuperAdmin()) return requested

  return LOGIN_ROUTE
}

export async function mountRoute(route?: string) {
  const target = document.getElementById('app')!
  target.innerHTML = ''

  const resolved = resolveRoute(route)
  const handler = getRouteHandler(resolved)
  const el = await handler()
  target.appendChild(el)

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

  // Sidebar menu item click delegation
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
