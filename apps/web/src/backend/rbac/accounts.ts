// src/backend/rbac/accounts.ts
import { getBaseUrl } from '../core/endpoints'
import { unary, stream } from '../core/rpc'

// ---- Generated stubs (adjust paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"
import { decodeJwtPayload } from '../core/session'

/** View-model shaped from resource.Account + a few UI niceties */
export type AccountVM = {
  // 1:1 proto fields
  id: string
  name: string
  email?: string
  password?: string
  refreshToken?: string
  domain?: string
  profilePicture?: string
  firstName?: string
  lastName?: string
  middle?: string
  organizations?: string[]
  groups?: string[]
  roles?: string[]
  typeName?: string

  // UI-friendly aliases/computed fields (not in proto)
  username: string
  displayName?: string
  // Keep these optional if your UI still references them; not in proto:
  status?: 'active' | 'disabled' | string
  createdAt?: Date

  // JWT convenience (not persisted)
  token?: string
  issuedAt?: number
  notBefore?: number
  expiresAt?: number
  issuer?: string
  audience?: string[] | string
}

// Back-compat alias (if other files import `Account`)
export type Account = AccountVM

/** Input shapes: align with proto fields directly */
export type CreateAccountInput = {
  name: string
  password?: string
  email?: string
  firstName?: string
  lastName?: string
  middle?: string
  domain?: string
  profilePicture?: string
  roles?: string[]
  groups?: string[]
  organizations?: string[]
}

export type UpdateAccountInput = Partial<CreateAccountInput> & {
  // ID comes separately in the function parameter
}

/** Correct names per resource.proto */
const SERVICE_METHODS = {
  list: {
    method: ['getAccounts'],
    rq: ['GetAccountsRqst'],
    // GetAccountsRsp => repeated Account accounts = 1 (grpc-web usually -> getAccountsList)
    rspListGetter: ['getAccountsList', 'getAccounts', 'accounts'],
  },
  create: {
    method: ['registerAccount'],
    rq: ['RegisterAccountRqst'],
    // RegisterAccountRsp has only `result`; no Account returned
    rspResultGetter: ['getResult', 'result'],
  },
  update: {
    method: ['setAccount'],
    rq: ['SetAccountRqst'],
    // SetAccountRsp is empty
  },
  delete: {
    method: ['deleteAccount'],
    rq: ['DeleteAccountRqst'],
  },
} as const

/* ------------------------------ helpers ------------------------------ */

function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? ''
  return new ResourceServiceClient(base, null, { withCredentials: true })
}

const TOKEN_KEY = '__globular_token__'

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY)
    return t ? { token: t, authorization: "Bearer " + t } : {}
  } catch {
    return {}
  }
}

/** Try multiple names for a request class; fall back to a plain {} if not found. */
function newRq(names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = (resource as any)[n]
    if (typeof Ctor === 'function') return new Ctor()
  }
  return {}
}

/** Pick the first method that exists on the client. */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === 'function') return n
  return names[0]
}

/** Safe read helpers */
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

/** Map proto Account → AccountVM */
export function toAccountVM(a: any): AccountVM {
  if (!a) {
    return {
      id: '',
      name: '',
      username: '',
    }
  }
  const first = getStr(a, ['getFirstName', 'getFirstname', 'firstName'], '')
  const mid = getStr(a, ['getMiddle', 'middle'], '')
  const last = getStr(a, ['getLastName', 'getLastname', 'lastName'], '')
  const display = [first, mid, last].filter(Boolean).join(' ').trim()

  const name = getStr(a, ['getName', 'name'], '')
  return {
    id: getStr(a, ['getId', 'id'], ''),
    name,
    email: getStr(a, ['getEmail', 'email'], '') || undefined,
    password: getStr(a, ['getPassword', 'password'], '') || undefined,
    refreshToken: getStr(a, ['getRefreshToken', 'getRefreshtoken', 'refreshToken', 'refreshtoken'], '') || undefined,
    domain: getStr(a, ['getDomain', 'domain'], '') || undefined,
    profilePicture: getStr(a, ['getProfilePicture', 'getProfilepicture', 'profilePicture', 'profilepicture'], '') || undefined,
    firstName: getStr(a, ['getFirstname', 'firstName'], '') || undefined,
    lastName: getStr(a, ['getLastname', 'lastName'], '') || undefined,
    middle: getStr(a, ['getMiddle', 'middle'], '') || undefined,
    organizations: getArr(a, ['getOrganizationsList', 'organizations', 'getOrganizations']) || [],
    groups: getArr(a, ['getGroupsList', 'groups', 'getGroups']) || [],
    roles: getArr(a, ['getRolesList', 'roles', 'getRoles']) || [],
    typeName: getStr(a, ['getTypeName', 'getTypename', 'typeName', 'typename'], '') || undefined,

    // UI sugar
    username: name,
    displayName: display || undefined,
  }
}

/** Ensure request has an `Account` submessage and return it */
function ensureRqAccount(rq: any): any {
  // Preferred path if getters/setters exist
  if (typeof rq?.getAccount === 'function') {
    let acc = rq.getAccount?.()
    if (!acc) {
      const Ctor: any = (resource as any)['Account']
      acc = Ctor ? new Ctor() : {}
      if (typeof rq.setAccount === 'function') rq.setAccount(acc)
      else rq.account = acc
    }
    return acc
  }
  // Fallback: create and attach
  const Ctor: any = (resource as any)['Account']
  const acc = Ctor ? new Ctor() : {}
  if (typeof rq.setAccount === 'function') rq.setAccount(acc)
  else rq.account = acc
  return acc
}

/* ------------------------------ API ------------------------------ */

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
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
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

export type ListAccountsOptions = BasicListOptions

export async function listAccounts(opts: ListAccountsOptions = {}): Promise<ListResult<AccountVM>> {
  const normalized = normalizeListOptions(opts)
  const rq = new resource.GetAccountsRqst()
  const queryString = toJsonString(normalized.query)
  if (queryString && typeof (rq as any).setQuery === "function") {
    (rq as any).setQuery(queryString)
  }
  const optPayload = buildOptionsPayload(normalized)
  const optionsString = toJsonString(optPayload)
  if (optionsString && typeof (rq as any).setOptions === "function") {
    (rq as any).setOptions(optionsString)
  }

  const out: AccountVM[] = []

  const takeFromMsg = (msg: any) => {
    // normal grpc-web: GetAccountsRsp has getAccountsList()
    if (typeof msg?.getAccountsList === 'function') {
      const list = msg.getAccountsList() || []
      for (const a of list) out.push(toAccountVM(a))
      return
    }
    // defensive fallbacks if your wrapper reshaped it
    if (Array.isArray(msg?.accounts)) {
      for (const a of msg.accounts) out.push(toAccountVM(a))
      return
    }
    if (typeof msg?.getId === 'function' || msg?.id) {
      out.push(toAccountVM(msg))
    }
  }

  const SERVICE_NAME = 'resource.ResourceService'
  await stream(
    clientFactory, // (addr) => new ResourceServiceClient(addr, ...)
    'getAccounts',       // RPC name
    rq,                  // GetAccountsRqst
    (m: any) => takeFromMsg(m),
    SERVICE_NAME         // 'resource.ResourceService'
  )

  const total = out.length
  let items = out
  const limit = typeof normalized.pageSize === "number" && normalized.pageSize > 0 ? normalized.pageSize : undefined
  if (limit !== undefined) {
    const start = typeof normalized.offset === "number" ? Math.max(0, normalized.offset) :
      (typeof normalized.page === "number" && normalized.page >= 0 ? normalized.page * limit : 0)
    items = out.slice(start, start + limit)
  }

  return withListResult(items, total)
}

export async function createAccount(input: CreateAccountInput): Promise<AccountVM> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.create.rq)
  const acc = ensureRqAccount(rq)

  // resource.Account fields
  if (input.name) { acc.setName?.(input.name); acc.setId?.(input.name) }
  if (input.email) acc.setEmail?.(input.email)
  if (input.password) acc.setPassword?.(input.password)
  if (input.firstName) acc.setFirstname?.(input.firstName)
  if (input.lastName) acc.setLastname?.(input.lastName)
  if (input.middle) acc.setMiddle?.(input.middle)
  if (input.domain) acc.setDomain?.(input.domain)
  if (input.profilePicture) acc.setProfilepicture?.(input.profilePicture)
  if (input.roles) acc.setRolesList?.(input.roles)
  if (input.groups) acc.setGroupsList?.(input.groups)
  if (input.organizations) acc.setOrganizationsList?.(input.organizations)

  // RegisterAccountRqst confirm_password (mirror password if present)
  if (typeof rq.setConfirmPassword === 'function' && input.password) {
    rq.setConfirmPassword(input.password)
  }

  const method = pickMethod(clientFactory(), SERVICE_METHODS.create.method)
  await unary(clientFactory, method, rq, undefined, md)

  // Proto doesn't return the created Account; echo what we sent (mapped)
  return toAccountVM(acc)
}

export async function updateAccount(id: string, patch: UpdateAccountInput): Promise<AccountVM> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.update.rq)
  const acc = ensureRqAccount(rq)

  acc.setId?.(id)
  if (patch.name) acc.setName?.(patch.name)
  if (patch.email) acc.setEmail?.(patch.email)
  if (patch.password) acc.setPassword?.(patch.password)
  if (patch.firstName) acc.setFirstname?.(patch.firstName)
  if (patch.lastName) acc.setLastname?.(patch.lastName)
  if (patch.middle) acc.setMiddle?.(patch.middle)
  if (patch.domain) acc.setDomain?.(patch.domain)
  if (patch.profilePicture) acc.setProfilepicture?.(patch.profilePicture)
  if (patch.roles) acc.setRolesList?.(patch.roles)
  if (patch.groups) acc.setGroupsList?.(patch.groups)
  if (patch.organizations) acc.setOrganizationsList?.(patch.organizations)

  const method = pickMethod(clientFactory(), SERVICE_METHODS.update.method)
  await unary(clientFactory, method, rq, undefined, md)

  // No Account in SetAccountRsp; return what we attempted to set
  return toAccountVM(acc)
}

export async function deleteAccount(id: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.delete.rq)
  rq.setId?.(id) // DeleteAccountRqst.id

  const method = pickMethod(clientFactory(), SERVICE_METHODS.delete.method)
  await unary(clientFactory, method, rq, undefined, md)
}

// Retrieve a single account by ID using GetAccountRqst
export async function getAccount(id: string): Promise<AccountVM | null> {
  const md = await meta()
  const rq = new resource.GetAccountRqst()
  rq.setAccountid?.(id)

  const rsp = await unary(clientFactory, 'getAccount', rq, undefined, md)
  const account = rsp && typeof (rsp as any).getAccount === 'function' ? (rsp as any).getAccount() : null
  return account ? toAccountVM(account) : null
}


export function getCurrentAccount(): AccountVM | null{
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) return null
  const payload = decodeJwtPayload(token)
  if (!payload) return null
  return toAccountVM(payload)
}

/* --------------------------------------------------------------------
 * NEW — getAccountsByIds(ids)
 * ------------------------------------------------------------------*/

/**
 * Fetch multiple accounts by IDs.
 * - Tries a dedicated RPC (`getAccountsByIds`) with several request/field name variants.
 * - Falls back to streaming `getAccounts` with a JSON `$in` query.
 * - Automatically batches large ID lists.
 */
export async function getAccountsByIds(
  ids: string[],
  opts: { batchSize?: number } = {}
): Promise<AccountVM[]> {
  const unique = Array.from(new Set((ids || []).map(String).filter(Boolean)))
  if (unique.length === 0) return []

  const batchSize = Math.max(1, opts.batchSize ?? 500)
  const results: AccountVM[] = []

  for (let i = 0; i < unique.length; i += batchSize) {
    const slice = unique.slice(i, i + batchSize)
    const chunk = await getAccountsByIdsOnce(slice)
    results.push(...chunk)
  }

  // Ensure deterministic order by input order (optional)
  const byId = new Map(results.map(a => [a.id, a]))
  return unique.map(id => byId.get(id)).filter(Boolean) as AccountVM[]
}

async function getAccountsByIdsOnce(ids: string[]): Promise<AccountVM[]> {
  const md = await meta()
  const client = clientFactory()

  // 1) Try dedicated unary RPCs first
  const rq = newRq([
    'GetAccountsByIdsRqst',
    'GetAccountsByIdsRequest',
    // as a last-ditch, reuse GetAccountsRqst if the backend put IDs + query there
    'GetAccountsRqst',
  ])

  // Try common setter variants for the list of IDs
  if (typeof rq.setAccountidsList === 'function') rq.setAccountidsList(ids)
  else if (typeof rq.setIdsList === 'function') rq.setIdsList(ids)
  else if (typeof rq.setIds === 'function') rq.setIds(ids)
  else if (typeof rq.setAccountids === 'function') rq.setAccountids(ids as any)
  else if (typeof rq.setQuery === 'function') rq.setQuery(JSON.stringify({ _id: { $in: ids } }))
  else {
    // attach plainly; some gateways accept raw fields
    rq.ids = ids
    rq.accountids = rq.accountids ?? ids
    rq.accountIds = rq.accountIds ?? ids
  }

  const method = pickMethod(client, ['getAccountsByIds', 'listAccountsByIds', 'getAccounts'])

  // If we picked a proper "byIds" method, use unary and parse list.
  if (method !== 'getAccounts') {
    const rsp: any = await unary(clientFactory, method, rq, undefined, md)
    return collectAccountsFromResponse(rsp)
  }

  // 2) Fallback: streaming getAccounts with $in query
  const out: AccountVM[] = []
  const rq2 = new resource.GetAccountsRqst()
  if (typeof (rq2 as any).setQuery === 'function') {
    ; (rq2 as any).setQuery(JSON.stringify({ _id: { $in: ids } }))
  }

  await stream(
    clientFactory,
    'getAccounts',
    rq2,
    (msg: any) => {
      if (typeof msg?.getAccountsList === 'function') {
        for (const a of msg.getAccountsList() || []) out.push(toAccountVM(a))
      } else if (Array.isArray(msg?.accounts)) {
        for (const a of msg.accounts) out.push(toAccountVM(a))
      } else if (msg && (typeof msg?.getId === 'function' || msg?.id)) {
        out.push(toAccountVM(msg))
      }
    },
    'resource.ResourceService'
  )

  return out
}

function collectAccountsFromResponse(rsp: any): AccountVM[] {
  const out: AccountVM[] = []
  if (!rsp) return out

  if (typeof rsp.getAccountsList === 'function') {
    for (const a of rsp.getAccountsList() || []) out.push(toAccountVM(a))
    return out
  }
  if (Array.isArray(rsp.accounts)) {
    for (const a of rsp.accounts) out.push(toAccountVM(a))
    return out
  }
  // Some gateways may stream but still yield single items—be tolerant:
  if (typeof rsp.getId === 'function' || rsp.id) {
    out.push(toAccountVM(rsp))
  }
  return out
}
