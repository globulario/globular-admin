import { Permission, Permissions } from "globular-web-client/rbac/rbac_pb"

const cloneList = (list) => Array.isArray(list) ? list.slice() : []

const buildSubjects = (src = {}) => ({
  accounts: cloneList(src.accounts || src.getAccountsList?.() || []),
  groups: cloneList(src.groups || src.getGroupsList?.() || []),
  applications: cloneList(src.applications || src.getApplicationsList?.() || []),
  organizations: cloneList(src.organizations || src.getOrganizationsList?.() || []),
  peers: cloneList(src.peers || src.getPeersList?.() || []),
})

const normalizeEntry = (perm) => ({
  name: perm?.getName?.() ?? perm?.name ?? "",
  accounts: cloneList(perm?.accounts || perm?.getAccountsList?.() || []),
  groups: cloneList(perm?.groups || perm?.getGroupsList?.() || []),
  applications: cloneList(perm?.applications || perm?.getApplicationsList?.() || []),
  organizations: cloneList(perm?.organizations || perm?.getOrganizationsList?.() || []),
  peers: cloneList(perm?.peers || perm?.getPeersList?.() || []),
})

const ensureOwnerEntry = (vm) => {
  if (!vm.owners) vm.owners = { accounts: [], groups: [], applications: [], organizations: [], peers: [] }
  for (const key of ["accounts","groups","applications","organizations","peers"]) {
    vm.owners[key] = cloneList(vm.owners[key])
  }
}

export function permissionsProtoToVM(perms) {
  if (!perms) {
    return {
      path: "",
      resourceType: "",
      owners: { accounts: [], groups: [], applications: [], organizations: [], peers: [] },
      allowed: [],
      denied: [],
    }
  }

  const ownersProto = perms.getOwners?.() || perms.getOwner?.() || {}

  const vm = {
    path: perms.getPath?.() ?? perms.path ?? "",
    resourceType:
      perms.getResourcetype?.() ??
      perms.getResourceType?.() ??
      perms.resourceType ??
      "",
    owners: buildSubjects(ownersProto),
    allowed: (perms.getAllowedList?.() ?? perms.allowed ?? []).map(normalizeEntry),
    denied: (perms.getDeniedList?.() ?? perms.denied ?? []).map(normalizeEntry),
  }

  ensureOwnerEntry(vm)
  return vm
}

const sanitizeSubjects = (value) => {
  const list = cloneList(value || [])
  return list
    .map((v) => {
      if (typeof v === "string") return v
      if (v && typeof v === "object") {
        if (typeof v.id === "string") return v.id
        if (typeof v.uuid === "string") return v.uuid
      }
      return v == null ? "" : String(v)
    })
    .filter((v) => typeof v === "string" && v.length > 0)
}

const applyList = (permission, listName, fallbackPropName, value) => {
  const sanitized = sanitizeSubjects(value)
  const clearFn = permission[`clear${listName}List`]
  const addFn = permission[`add${listName}`]
  if (typeof clearFn === "function" && typeof addFn === "function") {
    clearFn.call(permission)
    sanitized.forEach(v => addFn.call(permission, v))
    return
  }
  const setter = permission[`set${listName}List`]
  if (typeof setter === "function") {
    setter.call(permission, sanitized)
    return
  }
  const fallback = permission[fallbackPropName] ?? (permission[fallbackPropName] = [])
  fallback.splice(0, fallback.length, ...sanitized)
}

const entryToPermission = (entry) => {
  const p = new Permission()
  p.setName?.(entry.name ?? "")
  applyList(p, "Accounts", "accounts", entry.accounts || [])
  applyList(p, "Groups", "groups", entry.groups || [])
  applyList(p, "Applications", "applications", entry.applications || [])
  applyList(p, "Organizations", "organizations", entry.organizations || [])
  applyList(p, "Peers", "peers", entry.peers || [])
  return p
}

export function permissionsVMToProto(vmInput) {
  const vm = vmInput || {}
  const perms = new Permissions()
  const path = vm.path || ""
  perms.setPath?.(path)
  perms.path = path

  const resourceType = vm.resourceType || ""
  if (perms.setResourcetype) perms.setResourcetype(resourceType)
  else if (perms.setResourceType) perms.setResourceType(resourceType)
  else perms.resourceType = resourceType

  // Owners
  const ownerEntry = {
    name: "owner",
    ...(vm.owners || {}),
  }
  const ownerPerm = entryToPermission(ownerEntry)
  if (perms.setOwners) perms.setOwners(ownerPerm)
  else if (perms.setOwner) perms.setOwner(ownerPerm)
  else perms.owners = ownerPerm

  // Allowed / denied
  const allowedList = (vm.allowed || []).map(entryToPermission)
  const deniedList = (vm.denied || []).map(entryToPermission)

  if (perms.setAllowedList) perms.setAllowedList(allowedList)
  else perms.allowed = allowedList

  if (perms.setDeniedList) perms.setDeniedList(deniedList)
  else perms.denied = deniedList

  return perms
}
