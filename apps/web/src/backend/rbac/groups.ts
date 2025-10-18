// backend/rbac/groups.ts
// Groups backend in the same style as src/backend/accounts.ts

import { unary, stream } from "../core/rpc"
import { getBaseUrl } from "../core/endpoints"

// ---- Generated stubs (adjust paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"

// ----------------------------- Types -----------------------------

export type GroupVM = {
  id: string
  name: string
  description?: string
  members?: string[]       // account IDs
  domain?: string
  icon?: string
}

// Input shapes (align to proto fields you set)
export type CreateGroupInput = {
  id?: string             // if omitted we’ll slugify from name
  name: string
  description?: string
  members?: string[]
  domain?: string
  icon?: string
}

export type UpdateGroupInput = Partial<CreateGroupInput> & {
  // group id is passed separately in updateGroup()
}

// ------------------------- Service map --------------------------

const SERVICE = "resource.ResourceService"

const SERVICE_METHODS = {
  list: {
    method: ["getGroups"],
    rq: ["GetGroupsRqst"],
    // GetGroupsRsp => repeated Group groups = 1 (grpc-web -> getGroupsList)
    rspListGetter: ["getGroupsList", "getGroups", "groups"],
  },
  create: {
    method: ["createGroup"],
    rq: ["CreateGroupRqst"],
  },
  update: {
    method: ["updateGroup"],
    rq: ["UpdateGroupRqst"],
  },
  delete: {
    method: ["deleteGroup"],
    rq: ["DeleteGroupRqst"],
  },
  addMember: {
    method: ["addGroupMemberAccount"],
    rq: ["AddGroupMemberAccountRqst"],
  },
  removeMember: {
    method: ["removeGroupMemberAccount"],
    rq: ["RemoveGroupMemberAccountRqst"],
  }
} as const

// ---------------------------- Helpers ---------------------------

function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? ""
  return new ResourceServiceClient(base, null, { withCredentials: true })
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__")
    return t ? { token: t } : {}
  } catch {
    return {}
  }
}

/** Try multiple names for a request class; fall back to plain object */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (resource as any)[n]
    if (typeof Ctor === "function") return new Ctor()
  }
  return {}
}

/** Pick the first method that exists on the client. */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof (c as any)[n] === "function") return n
  return names[0]
}

/** Safe getters similar to accounts.ts */
const getStr = (obj: any, names: string[], alt?: any) => {
  for (const n of names) {
    const fn = obj?.[n]
    if (typeof fn === "function") return String(fn.call(obj))
    if (n in (obj || {})) return String(obj[n])
  }
  return alt === undefined ? "" : String(alt)
}

const getArr = (obj: any, names: string[]): string[] => {
  for (const n of names) {
    const fn = obj?.[n]
    const v = typeof fn === "function" ? fn.call(obj) : obj?.[n]
    if (Array.isArray(v)) return v.map(String)
  }
  return []
}

/** Map proto Group → GroupVM */
function toGroupVM(g: any): GroupVM {
  if (!g) return { id: "", name: "" }
  return {
    id: getStr(g, ["getId", "id"], ""),
    name: getStr(g, ["getName", "name"], ""),
    description: getStr(g, ["getDescription", "description"], "") || undefined,
    members: getArr(g, ["getAccountsList", "accounts", "getAccounts"]) || [],
    domain: getStr(g, ["getDomain", "domain"], "") || undefined,
    icon: getStr(g, ["getIcon", "icon"], "") || undefined,
  }
}


/** Ensure request has a `Group` submessage and return it, if your proto uses one. */
function ensureRqGroup(rq: any): any {
  if (typeof rq?.getGroup === "function") {
    let grp = rq.getGroup?.()
    if (!grp) {
      const Ctor: any = (resource as any)["Group"]
      grp = Ctor ? new Ctor() : {}
      if (typeof rq.setGroup === "function") rq.setGroup(grp)
      else rq.group = grp
    }
    return grp
  }
  // Fallback: create and attach
  const Ctor: any = (resource as any)["Group"]
  const grp = Ctor ? new Ctor() : {}
  if (typeof rq.setGroup === "function") rq.setGroup(grp)
  else rq.group = grp
  return grp
}

// ----------------------------- API ------------------------------

/** Stream groups (low-level) – handy for large result sets */
export async function streamGroups(
  query?: string,
  onChunk?: (msg: resource.GetGroupsRsp) => void
): Promise<void> {
  const rq = new resource.GetGroupsRqst()
  if ((rq as any).setQuery && query) (rq as any).setQuery(query)

  await stream<resource.GetGroupsRqst, resource.GetGroupsRsp>(
    (addr: string) => new ResourceServiceClient(addr, null, { withCredentials: true }),
    "getGroups",
    rq,
    (m) => onChunk?.(m),
    SERVICE
  )
}

/** List groups (collect all) */
export async function listGroups(query: object = {}): Promise<GroupVM[]> {
  const rq = new resource.GetGroupsRqst()
  if ((rq as any).setQuery) (rq as any).setQuery(JSON.stringify(query))

  const out: GroupVM[] = []
  const takeFromMsg = (msg: any) => {
    const list: any[] =
      typeof msg?.getGroupsList === "function" ? msg.getGroupsList() || []
      : Array.isArray(msg?.groups) ? msg.groups
      : []
    for (const g of list) out.push(toGroupVM(g))
  }

  await stream(
    clientFactory,            // ← zero-arg factory (same as accounts.ts)
    "getGroups",
    rq,
    (m: any) => takeFromMsg(m),
    SERVICE
  )

  return out
}

/** Convenience: accept a JSON string like the older wrapper */
export async function getGroups(query: string = "{}"): Promise<GroupVM[]> {
  try {
    const obj = JSON.parse(query || "{}")
    return await listGroups(obj)
  } catch {
    // if invalid JSON, fallback to empty filter
    return await listGroups({})
  }
}

/** Get a single group by id */
export async function getGroupById(id: string): Promise<GroupVM | null> {
  const list = await listGroups({ _id: id })
  return list[0] || null
}

/** Create a group */
export async function createGroup(input: CreateGroupInput): Promise<GroupVM> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.create.rq)
  const group = ensureRqGroup(rq)

  // If ID not provided, slugify from name
  const id = input.id?.trim() || input.name.trim().toLowerCase().replace(/\s+/g, "-")

  group.setId?.(id)
  group.setName?.(input.name)
  if (input.description) group.setDescription?.(input.description)
  if (input.domain) group.setDomain?.(input.domain)
  if (input.members && typeof group.setMembersList === "function") {
    group.setMembersList(input.members)
  }

  const method = pickMethod(clientFactory(), SERVICE_METHODS.create.method)
  await unary(clientFactory, method, rq, undefined, md)

  return toGroupVM(group)
}

/** Update a group (supports both full Group or $set-style JSON depending on backend) */
export async function updateGroup(id: string, patch: UpdateGroupInput): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.update.rq)

  // Two common variants:
  // 1) UpdateGroupRqst has setGroup(Group) → set fields directly
  // 2) UpdateGroupRqst has setGroupid(id) + setValues(JSON.stringify({$set:{...}}))
  //
  // We’ll try #2 first (as your organizations update does), then fall back to #1.

  if (typeof (rq as any).setGroupid === "function" && typeof (rq as any).setValues === "function") {
    ;(rq as any).setGroupid(id)
    const $set: Record<string, any> = {}
    if (patch.name !== undefined) $set["name"] = patch.name
    if (patch.description !== undefined) $set["description"] = patch.description
    if (patch.domain !== undefined) $set["domain"] = patch.domain
    if (patch.icon !== undefined) $set["icon"] = patch.icon
    if (patch.members !== undefined) $set["members"] = patch.members
    ;(rq as any).setValues(JSON.stringify({ $set }))
  } else {
    // Fallback: attach Group and set fields directly
    const grp = ensureRqGroup(rq)
    grp.setId?.(id)
    if (patch.name !== undefined) grp.setName?.(patch.name)
    if (patch.description !== undefined) grp.setDescription?.(patch.description)
    if (patch.icon !== undefined) grp.setIcon?.(patch.icon)
    if (patch.domain !== undefined) grp.setDomain?.(patch.domain)
    if (patch.members && typeof grp.setMembersList === "function") {
      grp.setMembersList(patch.members)
    }
  }

  const method = pickMethod(clientFactory(), SERVICE_METHODS.update.method)
  await unary(clientFactory, method, rq, undefined, md)
}

/** Delete a group */
export async function deleteGroup(id: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.delete.rq)

  // Common fields: DeleteGroupRqst.group / .groupid / .id — try them safely
  rq.setGroup?.(id)
  rq.setGroupid?.(id)
  rq.setId?.(id)

  const method = pickMethod(clientFactory(), SERVICE_METHODS.delete.method)
  await unary(clientFactory, method, rq, undefined, md)
}

/** Add an account to a group */
export async function addGroupMember(groupId: string, accountId: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.addMember.rq)

  rq.setGroupid?.(groupId)
  rq.setAccountid?.(accountId)
  // defensively assign if your proto uses different fields
  rq.groupid = rq.groupid ?? groupId
  rq.accountid = rq.accountid ?? accountId

  const method = pickMethod(clientFactory(), SERVICE_METHODS.addMember.method)
  await unary(clientFactory, method, rq, undefined, md)
}

/** Remove an account from a group */
export async function removeGroupMember(groupId: string, accountId: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.removeMember.rq)

  rq.setGroupid?.(groupId)
  rq.setAccountid?.(accountId)
  rq.groupid = rq.groupid ?? groupId
  rq.accountid = rq.accountid ?? accountId

  const method = pickMethod(clientFactory(), SERVICE_METHODS.removeMember.method)
  await unary(clientFactory, method, rq, undefined, md)
}

