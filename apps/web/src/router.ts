// router.ts
type RouteHandler = () => HTMLElement

// --- Import page components ---
import './pages/login'
import './pages/dashboard'
// Cluster
import './pages/cluster_nodes'
import './pages/cluster_reconciliation'
import './pages/cluster_join'
import './pages/cluster_topology'
// Services
import './pages/services_instances'
import './pages/services_catalog'
import './pages/services_detail'
// Security
import './pages/security_certificates'
import './pages/security_secrets'
import './pages/security_cors'
import './pages/rbac_accounts'
import './pages/rbac_orgs'
import './pages/rbac_groups'
import './pages/rbac_roles'
// Infrastructure
import './pages/infrastructure_overview'
import './pages/infrastructure_storage'
import './pages/infrastructure_dns'
import './pages/infrastructure_networking'
import './pages/infrastructure_control_plane'
import './pages/infrastructure_observability'
// Observability
import './pages/observability_metrics'
import './pages/observability_logs'
import './pages/observability_events'
// Repository & Admin Tools
import './pages/repo_market'
import './pages/admin_diagnostics'
import './pages/admin_upgrades'
import './pages/admin_backups'
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

// Which routes can be seen without being authenticated
const PUBLIC_ROUTES = new Set<string>(['#/login'])

const routes: Record<string, RouteHandler> = {
  '#/login': () => {
    const el = document.createElement('page-login')
    el.setAttribute('app-name', 'Globular Admin')
    el.setAttribute('logo-src', './img/logo.png')
    el.setAttribute('version', 'v0.9.0')
    return el
  },

  // Overview
  '#/dashboard': () => document.createElement('page-dashboard'),

  // Cluster
  '#/cluster/nodes':          () => document.createElement('page-cluster-nodes'),
  '#/cluster/reconciliation': () => document.createElement('page-cluster-reconciliation'),
  '#/cluster/join':           () => document.createElement('page-cluster-join'),
  '#/cluster/topology':       () => document.createElement('page-cluster-topology'),

  // Services
  '#/services/instances': () => document.createElement('page-services-instances'),
  '#/services/catalog':   () => document.createElement('page-services-catalog'),

  // Security
  '#/security/certificates':        () => document.createElement('page-security-certificates'),
  '#/security/secrets':             () => document.createElement('page-security-secrets'),
  '#/security/cors':                () => document.createElement('page-security-cors'),
  '#/security/rbac/accounts':       () => document.createElement('page-rbac-accounts'),
  '#/security/rbac/organizations':  () => document.createElement('page-rbac-organizations'),
  '#/security/rbac/groups':         () => document.createElement('page-rbac-groups'),
  '#/security/rbac/roles':          () => document.createElement('page-rbac-roles'),

  // Infrastructure
  '#/infrastructure/overview':      () => document.createElement('page-infrastructure-overview'),
  '#/infrastructure/storage':       () => document.createElement('page-infrastructure-storage'),
  '#/infrastructure/dns':           () => document.createElement('page-infrastructure-dns'),
  '#/infrastructure/networking':    () => document.createElement('page-infrastructure-networking'),
  '#/infrastructure/control-plane': () => document.createElement('page-infrastructure-control-plane'),
  '#/infrastructure/observability': () => document.createElement('page-infrastructure-observability'),

  // Observability
  '#/observability/metrics': () => document.createElement('page-observability-metrics'),
  '#/observability/logs':    () => document.createElement('page-observability-logs'),
  '#/observability/events':  () => document.createElement('page-observability-events'),

  // Repository
  '#/repository': () => document.createElement('page-repository'),

  // Admin Tools
  '#/admin/diagnostics': () => document.createElement('page-admin-diagnostics'),
  '#/admin/upgrades':    () => document.createElement('page-admin-upgrades'),
  '#/admin/backups':     () => document.createElement('page-admin-backups'),
}

const SERVICE_DETAIL_PREFIX = '#/services/'
const SERVICE_DETAIL_EXCLUSIONS = new Set<string>([
  '#/services/catalog',
  '#/services/instances',
])

const DEFAULT_ROUTE = '#/dashboard'
const LOGIN_ROUTE = '#/login'

function createServiceDetailHandler(route: string): RouteHandler | null {
  if (!route.startsWith(SERVICE_DETAIL_PREFIX)) return null
  if (SERVICE_DETAIL_EXCLUSIONS.has(route)) return null
  const raw = route.slice(SERVICE_DETAIL_PREFIX.length)
  if (!raw) return null
  const serviceName = decodeURIComponent(raw)
  return () => {
    const el = document.createElement('page-service-detail')
    el.setAttribute('service-name', serviceName)
    return el
  }
}

function getRouteHandler(route: string): RouteHandler {
  return createServiceDetailHandler(route) ?? routes[route] ?? routes[DEFAULT_ROUTE]
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

export function mountRoute(route?: string) {
  const target = document.getElementById('app')!
  target.innerHTML = ''

  const resolved = resolveRoute(route)
  const handler = getRouteHandler(resolved)
  target.appendChild(handler())

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
