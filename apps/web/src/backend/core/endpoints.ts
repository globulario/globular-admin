export const DEFAULT_BASE = typeof localStorage !== 'undefined' && localStorage.getItem('globular.baseUrl')
  || (typeof window !== 'undefined' ? window.location.origin : 'https://globule-ryzen.globular.io');

const SERVICE_PATHS: Record<string,string> = {
  "rbac.RbacService": "/rbac.RbacService",
  "resource.ResourceService": "/resource.ResourceService",
  "file.FileService": "/file.FileService",
  "event.EventService": "/event.EventService",
  "authentication.AuthenticationService": "/authentication.AuthenticationService",
}

export function serviceUrl(serviceId: string, base = DEFAULT_BASE) {
  const path = SERVICE_PATHS[serviceId]
  if (!path) throw new Error(`Unknown serviceId: ${serviceId}`)
  return base + path
}
