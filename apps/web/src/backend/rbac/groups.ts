// backend/rbac/groups.ts
// Groups backend in the same style as src/backend/rbac/accounts.ts

import { unary, stream } from "../core/rpc"
import { getBaseUrl } from "../core/endpoints"

// ---- Generated stubs (adjust paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"

// Also use accounts API to hydrate member IDs → Account objects
import { getAccountsByIds, type Account } from "./accounts"

// ----------------------------- Types -----------------------------

export type GroupVM = {
  id: string
  name: string
  description?: string
  members?: string[]       // account IDs
  domain?: string
  roles?: string[]
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
  roles?: string[]
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
type BasicListOptions = string | {
  query?: object | string
  pageSize?: number
  page?: number
  limit?: number
  offset?: number
  options?: object | string
}

type ListResult<T> = T[] & { items: T[]; total: number }
const LIST_OPTION_KEYS = new Set(["query","pageSize","page","limit","offset","options"])

function normalizeListOptions(input?: BasicListOptions) {
  if (input == null) return {}
  if (typeof input === "string") return { query: input }
  const keys = Object.keys(input)
  const hasKnown = keys.some(k => LIST_OPTION_KEYS.has(k))
  return {
    query: hasKnown ? input.query : input,
    pageSize: input.pageSize ?? input.limit,
    page: input.page,
    offset: input.offset,
    options: input.options,
  }
}

function toJsonString(value: any): string | undefined {
  if (value === undefined || value === null || value === "") return undefined
  if (typeof value === "string") return value
  try { return JSON.stringify(value) } catch { return undefined }
}

function withListResult<T>(items: T[], total = items.length): ListResult<T> {
  const arr: any = items
  arr.items = items
  arr.total = total
  return arr
}

function buildOptionsPayload(opts: { pageSize?: number; page?: number; offset?: number; options?: any }) {
  if (opts.options !== undefined) return opts.options
  const payload: any = {}
  if (typeof opts.pageSize === "number" && opts.pageSize > 0) payload.pageSize = opts.pageSize
  if (typeof opts.page === "number" && opts.page >= 0) payload.page = opts.page
  if (typeof opts.offset === "number" && opts.offset >= 0) payload.offset = opts.offset
  return Object.keys(payload).length ? payload : undefined
}

export async function listGroups(opts: BasicListOptions = {}): Promise<ListResult<GroupVM>> {
  const normalized = normalizeListOptions(opts)
  const rq = new resource.GetGroupsRqst()
  const queryString = toJsonString(normalized.query)
  if ((rq as any).setQuery && queryString) (rq as any).setQuery(queryString)
  const optPayload = buildOptionsPayload(normalized)
  const optionsString = toJsonString(optPayload)
  if (optionsString && typeof (rq as any).setOptions === "function") {
    (rq as any).setOptions(optionsString)
  }

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

  const total = out.length
  const limit = typeof normalized.pageSize === "number" && normalized.pageSize > 0 ? normalized.pageSize : undefined
  let items = out
  if (limit !== undefined) {
    const start = typeof normalized.offset === "number" ? Math.max(0, normalized.offset) :
      (typeof normalized.page === "number" && normalized.page >= 0 ? normalized.page * limit : 0)
    items = out.slice(start, start + limit)
  }

  return withListResult(items, total)
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

/* -------------------- NEW: listGroupMembers -------------------- */

/**
 * Return full Account objects for all members of a group.
 * - Prefers the `members` array from GetGroups if present.
 * - Falls back to RPC methods commonly used for membership listing.
 * - Hydrates IDs → Account objects via accounts backend.
 */
export async function listGroupMembers(
  groupId: string,
  opts: { batchSize?: number } = {}
): Promise<Account[]> {
  const batchSize = Math.max(1, opts.batchSize ?? 500)

  // 1) Gather member IDs (from group doc or explicit RPC)
  const ids = await collectMemberIds(groupId)

  if (ids.length === 0) return []

  // 2) Hydrate accounts in batches
  const out: Account[] = []
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize)
    const chunk = await getAccountsByIdsSafe(slice)
    out.push(...chunk)
  }
  return out
}

async function collectMemberIds(groupId: string): Promise<string[]> {
  // Try to get from the group document first
  const fromGroup = await getGroupById(groupId)
  const groupMembers = fromGroup?.members ?? []
  if (groupMembers.length > 0) return groupMembers

  // Fallback to explicit RPC (handle multiple proto name variants)
  const md = await meta()
  const rq = newRq(["ListGroupMembersRqst", "GetGroupMembersRqst", "GetGroupMembersRequest"])

  rq.setGroupid?.(groupId)
  rq.setId?.(groupId)
  rq.groupid = rq.groupid ?? groupId
  rq.id = rq.id ?? groupId

  const client = clientFactory()
  const method = pickMethod(client, ["listGroupMembers", "getGroupMembers", "ListGroupMembers", "GetGroupMembers"])

  const rsp: any = await unary(clientFactory, method, rq, undefined, md)

  // Accept several plausible response shapes:
  // - repeated string accountIds = 1  → getAccountidsList()
  // - repeated Member members = 1     → members[].getAccountid()
  // - { accountIds: string[] }        → accountIds
  // - { members: [{accountId: string}|string] }
  const out: string[] = []

  const idsFromList = (arr: any[]) => {
    for (const m of arr || []) {
      if (typeof m === "string") { out.push(m); continue }
      const id =
        (typeof m?.getAccountid === "function" && m.getAccountid()) ||
        (typeof m?.getId === "function" && m.getId()) ||
        m?.accountId ||
        m?.id
      if (id) out.push(String(id))
    }
  }

  // getAccountidsList()
  if (typeof rsp?.getAccountidsList === "function") {
    idsFromList(rsp.getAccountidsList())
  }
  // members list in various forms
  else if (typeof rsp?.getMembersList === "function") {
    idsFromList(rsp.getMembersList())
  } else if (Array.isArray(rsp?.members)) {
    idsFromList(rsp.members)
  } else if (Array.isArray(rsp?.accountIds)) {
    idsFromList(rsp.accountIds)
  }

  return out
}

async function getAccountsByIdsSafe(ids: string[]): Promise<Account[]> {
  try {
    return await getAccountsByIds(ids)
  } catch {
    // Fallback to a generic RPC if your accounts wrapper is unavailable at runtime
    const rsp = await unary<any, { accounts?: Account[] }>(
      clientFactory,
      "getAccountsByIds",
      // Adjust request class name if your proto differs
      { ids } as any
    )
    return rsp?.accounts ?? []
  }
}
