
type RouteHandler = () => HTMLElement

const routes: Record<string, RouteHandler> = {
  '#/dashboard': () => document.createElement('page-dashboard'),
  '#/cluster': () => document.createElement('page-cluster-overview'),
  '#/cluster/peers': () => document.createElement('page-cluster-peers'),
  '#/cluster/services': () => document.createElement('page-cluster-services'),
  '#/cluster/apps': () => document.createElement('page-cluster-apps'),
  '#/cluster/dns': () => document.createElement('page-cluster-dns'),
  '#/rbac/accounts': () => document.createElement('page-rbac-accounts'),
  '#/rbac/organizations': () => document.createElement('page-rbac-organizations'),
  '#/rbac/groups': () => document.createElement('page-rbac-groups'),
  '#/rbac/roles': () => document.createElement('page-rbac-roles'),
  '#/cms/browser': () => document.createElement('page-cms-browser'),
  '#/console': () => document.createElement('page-console'),
  '#/repository': () => document.createElement('page-repository'),
}

const DEFAULT_ROUTE = '#/dashboard'

export function mountRoute(route?: string) {
  const target = document.getElementById('app')!
  target.innerHTML = ''
  const handler = routes[route || window.location.hash] || routes[DEFAULT_ROUTE]
  target.appendChild(handler())
}

export function startRouter() {
  // First render
  if (!window.location.hash) {
    history.replaceState(null, '', DEFAULT_ROUTE)
  }
  mountRoute()

  // Listen to hash changes
  window.addEventListener('hashchange', () => mountRoute())

  // Sidebar event delegation (handles nested custom elements via composedPath)
  document.addEventListener('click', (ev) => {
    const path = (ev.composedPath && ev.composedPath()) as Array<EventTarget & { tagName?: string, getAttribute?: Function }> || []
    const item = path.find((el) => el?.tagName?.toLowerCase?.() === 'globular-sidebar-menu-item')
    if (!item) return
    const route = item.getAttribute && item.getAttribute('route')
    if (route) {
      if (window.location.hash !== route) {
        history.pushState(null, '', route)
        mountRoute(route)
      }
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, { capture: true })
}
