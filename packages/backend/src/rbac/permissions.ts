// src/backend/rbac/permissions.ts
import { getBaseUrl } from '../core/endpoints'
import { unary, stream } from '../core/rpc'

// ---- Generated stubs (adjust import paths if needed) ----
import { RbacServiceClient } from 'globular-web-client/rbac/rbac_grpc_web_pb'
import * as rbac from 'globular-web-client/rbac/rbac_pb'

// Re-export common enums used by callers (e.g., SubjectType)
export const SubjectType = rbac.SubjectType

// ------------------------------ client / meta ------------------------------
function clientFactory(): RbacServiceClient {
  const base = getBaseUrl() ?? ''
  return new RbacServiceClient(base, null, { withCredentials: true })
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}

// ------------------------------ utils ------------------------------
/** Try multiple names for a request class; fallback to {} if not found */
function newRq(ns: any, names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = ns?.[n]
    if (typeof Ctor === 'function') return new Ctor()
  }
  return {}
}

/** Pick the first method that exists on the client. */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === 'function') return n
  return names[0]
}

// Small field helpers (robust to generator diffs)
const getStr = (obj: any, names: string[], alt?: any) => {
  for (const n of names) {
    const fn = obj?.[n]
    if (typeof fn === 'function') return String(fn.call(obj))
    if (n in (obj || {})) return String(obj[n])
  }
  return alt === undefined ? '' : String(alt)
}

const getArr = (obj: any, names: string[]): string[] => {
  for (const n of names) {
    const fn = obj?.[n]
    const v = typeof fn === 'function' ? fn.call(obj) : obj?.[n]
    if (Array.isArray(v)) return v.map(String)
  }
  return []
}

// ------------------------------ service map ------------------------------
const SERVICE_NAME = 'rbac.RbacService' as const

const METHODS = {
  get: {
    method: ['getResourcePermissions'],
    rq: ['GetResourcePermissionsRqst'],
  },
  set: {
    method: ['setResourcePermissions'],
    rq: ['SetResourcePermissionsRqst'],
  },
  del: {
    method: ['deleteResourcePermissions'],
    rq: ['DeleteResourcePermissionsRqst'],
  },
  listByType: {
    method: ['getResourcePermissionsByResourceType'],
    rq: ['GetResourcePermissionsByResourceTypeRqst'],
    rspListGetter: ['getPermissionsList', 'permissions'],
  },
  shared: {
    method: ['getSharedResource'],
    rq: ['GetSharedResourceRqst'],
    rspListGetter: ['getSharedresourceList', 'sharedresource'],
  },
  unshare: {
    method: ['removeSubjectFromShare'],
    rq: ['RemoveSubjectFromShareRqst'],
  },
} as const

// ------------------------------ VM helpers (optional) ------------------------------
export type PermissionSubjectLists = {
  accounts: string[]
  groups: string[]
  applications: string[]
  organizations: string[]
  peers: string[]
}

export type PermissionEntryVM = {
  name: string
} & PermissionSubjectLists

export type PermissionsVM = {
  path: string
  resourceType: string
  owners: PermissionSubjectLists
  allowed: PermissionEntryVM[]
  denied: PermissionEntryVM[]
}

export function toPermissionsVM(p: any): PermissionsVM {
  const owners = p?.getOwners?.()
  const mapSubjects = (perm: any): PermissionSubjectLists => ({
    accounts: getArr(perm, ['getAccountsList', 'accounts']),
    groups: getArr(perm, ['getGroupsList', 'groups']),
    applications: getArr(perm, ['getApplicationsList', 'applications']),
    organizations: getArr(perm, ['getOrganizationsList', 'organizations']),
    peers: getArr(perm, ['getPeersList', 'peers']),
  })

  const mapEntry = (perm: any): PermissionEntryVM => ({
    name: getStr(perm, ['getName', 'name'], ''),
    ...mapSubjects(perm),
  })

  return {
    path: getStr(p, ['getPath', 'path'], ''),
    resourceType: getStr(p, ['getResourceType', 'resourceType'], ''),
    owners: owners ? mapSubjects(owners) : { accounts: [], groups: [], applications: [], organizations: [], peers: [] },
    allowed: (p?.getAllowedList?.() ?? p?.allowed ?? []).map(mapEntry),
    denied: (p?.getDeniedList?.() ?? p?.denied ?? []).map(mapEntry),
  }
}

// ------------------------------ API ------------------------------

/**
 * Get permissions for a single resource path.
 */
export async function getResourcePermissions(path: string): Promise<rbac.Permissions> {
  const md = await meta()
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.get.rq)
  rq.setPath?.(path)
  const rsp: any = await unary(() => c, pickMethod(c, METHODS.get.method), rq, undefined, md)
  // Response usually is GetResourcePermissionsRsp with a Permissions inside or direct Permissions.
  const perms = rsp?.getPermissions?.() ?? rsp?.permissions ?? rsp
  return perms as rbac.Permissions
}

/**
 * Set permissions for a resource.
 * Accepts a concrete rbac.Permissions (callers that build the message can pass it).
 */
export async function setResourcePermissions(permissions: rbac.Permissions): Promise<void> {

  const md = await meta()
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.set.rq)
  rq.setPath?.(permissions.getPath?.() ?? '')

  rq.setPermissions?.(permissions)
  // Ensure resource type is present if your backend requires it
  if (!permissions.getResourceType?.() && permissions.setResourceType) {
    permissions.setResourceType('file')
  }

  rq.setResourcetype?.(permissions.getResourceType?.() ?? '')

  await unary(() => c, pickMethod(c, METHODS.set.method), rq, undefined, md)
}

/**
 * Delete permissions for a resource path of a given type.
 */
export async function deleteResourcePermissions(path: string, resourceType: string): Promise<void> {
  const md = await meta()
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.del.rq)
  rq.setPath?.(path)
  rq.setResourcetype?.(resourceType)
  await unary(() => c, pickMethod(c, METHODS.del.method), rq, undefined, md)
}

/**
 * List permissions entries (as raw rbac.Permissions) for a resource type, via server stream.
 * If you prefer VMs, map with toPermissionsVM after.
 */
export async function listResourcePermissionsByType(resourceType: string): Promise<rbac.Permissions[]> {
  const out: rbac.Permissions[] = []
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.listByType.rq)
  rq.setResourcetype?.(resourceType)

  await stream(
    () => c,
    pickMethod(c, METHODS.listByType.method),
    rq,
    (chunk: any) => {
      let arr: any[] = []
      for (const g of METHODS.listByType.rspListGetter) {
        const fn = chunk?.[g]
        const v = typeof fn === 'function' ? fn.call(chunk) : chunk?.[g]
        if (Array.isArray(v) && v.length) { arr = v; break }
      }
      if (arr && arr.length) out.push(...arr)
    },
    SERVICE_NAME
  )
  return out
}

/**
 * Get shared resources between an owner and a subject (account/group/etc.)
 * ownerFqdn:   "id@domain" of the owner
 * subjectFqdn: "id@domain" of the subject
 * type: rbac.SubjectType (exported above)
 * Returns the repeated SharedResource list from the response.
 */
export async function getSharedResources(ownerFqdn: string, subjectFqdn: string, type: number): Promise<any[]> {
  const md = await meta()
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.shared.rq)
  rq.setOwner?.(ownerFqdn)
  rq.setSubject?.(subjectFqdn)
  rq.setType?.(type)

  const rsp: any = await unary(() => c, pickMethod(c, METHODS.shared.method), rq, undefined, md)

  for (const g of METHODS.shared.rspListGetter) {
    const fn = rsp?.[g]
    const v = typeof fn === 'function' ? fn.call(rsp) : rsp?.[g]
    if (Array.isArray(v)) return v
  }
  return []
}

/**
 * Remove a subject (account/group/etc.) from a share of a specific resource path.
 * domain: resource owner domain (if your backend needs it in the request)
 */
export async function removeSubjectFromShare(domain: string, path: string, type: number, subjectFqdn: string): Promise<void> {
  const md = await meta()
  const c = clientFactory()
  const rq = newRq(rbac, METHODS.unshare.rq)
  rq.setDomain?.(domain)
  rq.setPath?.(path)
  rq.setType?.(type)
  rq.setSubject?.(subjectFqdn)
  await unary(() => c, pickMethod(c, METHODS.unshare.method), rq, undefined, md)
}

// ------------------------------ factories for building messages ------------------------------

/** Create a new empty Permissions message (for callers who prefer composing the proto). */
export function newPermissions(): rbac.Permissions {
  const Ctor: any = (rbac as any).Permissions
  return new Ctor()
}

/** Create a new empty Permission entry message. */
export function newPermission(name?: string): rbac.Permission {
  const Ctor: any = (rbac as any).Permission
  const p = new Ctor()
  if (name) p.setName?.(name)
  return p
}

// Optional helpers to mutate a Permission entry (kept simple, callers can call the proto setters directly)
export const setPermissionSubjects = (perm: rbac.Permission, lists: Partial<PermissionSubjectLists>) => {
  if (lists.accounts) perm.setAccountsList?.(lists.accounts)
  if (lists.groups) perm.setGroupsList?.(lists.groups)
  if (lists.applications) perm.setApplicationsList?.(lists.applications)
  if (lists.organizations) perm.setOrganizationsList?.(lists.organizations)
  if (lists.peers) perm.setPeersList?.(lists.peers)
}
