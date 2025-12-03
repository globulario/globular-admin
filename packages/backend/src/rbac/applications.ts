// src/backend/apps.ts
import { getBaseUrl } from '../core/endpoints'
import { unary, stream } from '../core/rpc'

// ---- Generated stubs (adjust import paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"

// + Applications Manager
import { ApplicationManagerServiceClient } from "globular-web-client/applications_manager/applications_manager_grpc_web_pb"
import * as appmgr from "globular-web-client/applications_manager/applications_manager_pb"

// + Discovery (install/uninstall)
import { PackageDiscoveryClient } from "globular-web-client/discovery/discovery_grpc_web_pb"
import * as discovery from "globular-web-client/discovery/discovery_pb"

// + Repository (publish, bundles)
import { PackageRepositoryClient } from "globular-web-client/repository/repository_grpc_web_pb"
import * as repo from "globular-web-client/repository/repository_pb"

// View-model aligned to resource.Application with a couple UI niceties
export type ApplicationVM = {
  // proto 1:1
  id: string
  name: string
  domain?: string
  password?: string
  path?: string
  version?: string
  description?: string
  actions?: string[]
  keywords?: string[]
  icon?: string
  alias?: string
  publisherId?: string
  creationDate?: number // unix sec
  lastDeployed?: number // unix sec
  typeName?: string

  // UI helpers
  displayName?: string
}

// ------------------------------ clients / meta ------------------------------
function clientFactory(): ResourceServiceClient {
  const base = getBaseUrl() ?? ''
  return new ResourceServiceClient(base, null, { withCredentials: true })
}
function appMgrClient(): ApplicationManagerServiceClient {
  const base = getBaseUrl() ?? ''
  return new ApplicationManagerServiceClient(base, null, { withCredentials: true })
}
function discoveryClient(): PackageDiscoveryClient {
  const base = getBaseUrl() ?? ''
  return new PackageDiscoveryClient(base, null, { withCredentials: true })
}
function repositoryClient(): PackageRepositoryClient {
  const base = getBaseUrl() ?? ''
  return new PackageRepositoryClient(base, null, { withCredentials: true })
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
/** Try multiple names for a request class in a given namespace; fallback to {} if not found */
function newRqIn(ns: any, names: readonly string[]): any {
  for (const n of names) {
    const Ctor: any = ns?.[n]
    if (typeof Ctor === 'function') return new Ctor()
  }
  return {}
}
/** Try multiple names for a request class; fallback to {} if not found (resource namespace default) */
function newRq(names: readonly string[]): any { return newRqIn(resource, names) }

/** Pick the first method that exists on the client. */
function pickMethod(c: any, names: readonly string[]): string {
  for (const n of names) if (typeof c[n] === 'function') return n
  return names[0]
}

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

const getNum = (obj: any, names: string[], alt = 0) => {
  const s = getStr(obj, names, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : alt
}

type BasicListOptions = string | {
  query?: object | string
  pageSize?: number
  page?: number
  limit?: number
  offset?: number
  options?: object | string
}

type NormalizedListOptions = {
  query?: object | string
  pageSize?: number
  page?: number
  offset?: number
  options?: object | string
}

type ListResult<T> = T[] & { items: T[]; total: number }
const LIST_OPTION_KEYS = new Set(["query","pageSize","page","limit","offset","options"])

function normalizeListOptions(input?: BasicListOptions): NormalizedListOptions {
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

// ------------------------------ mapping ------------------------------
export function toApplicationVM(a: any): ApplicationVM {
  if (!a) return { id: '', name: '' }

  const vm: ApplicationVM = {
    id:           getStr(a, ['getId', 'id'], ''),
    name:         getStr(a, ['getName', 'name'], ''),
    domain:       getStr(a, ['getDomain', 'domain'], ''),
    password:     getStr(a, ['getPassword', 'password'], ''),
    path:         getStr(a, ['getPath', 'path'], ''),
    version:      getStr(a, ['getVersion', 'version'], ''),
    description:  getStr(a, ['getDescription', 'description'], ''),
    actions:      getArr(a, ['getActionsList', 'actions']),
    keywords:     getArr(a, ['getKeywordsList', 'keywords']),
    icon:         getStr(a, ['getIcon', 'icon'], ''),
    alias:        getStr(a, ['getAlias', 'alias'], ''),
    publisherId:  getStr(a, ['getPublisherid', 'getPublisherId', 'PublisherID', 'publisherId'], ''),
    creationDate: getNum(a, ['getCreationDate', 'creationDate'], 0),
    lastDeployed: getNum(a, ['getLastDeployed', 'lastDeployed'], 0),
    typeName:     getStr(a, ['getTypename', 'getTypeName', 'typeName'], ''),
  }
  vm.displayName = vm.alias || vm.name
  return vm
}

// ------------------------------ Resource service methods ------------------------------
const SERVICE_NAME = 'resource.ResourceService' as const

const SERVICE_METHODS = {
  list: {
    method: ['getApplications'],
    rq: ['GetApplicationsRqst'],
    rspListGetter: ['getApplicationsList', 'applications'],
  },
  create: {
    method: ['createApplication'],
    rq: ['CreateApplicationRqst'],
  },
  update: {
    method: ['updateApplication'],
    rq: ['UpdateApplicationRqst'],
  },
  delete: {
    method: ['deleteApplication'],
    rq: ['DeleteApplicationRqst'],
  },
  addActions: {
    method: ['addApplicationActions'],
    rq: ['AddApplicationActionsRqst'],
  },
  removeAction: {
    method: ['removeApplicationAction'],
    rq: ['RemoveApplicationActionRqst'],
  },
  removeAllAction: {
    method: ['removeApplicationsAction'],
    rq: ['RemoveApplicationsActionRqst'],
  },
  getVersion: {
    method: ['getApplicationVersion'],
    rq: ['GetApplicationVersionRqst'],
  },
} as const

// ------------------------------ API (resource) ------------------------------
export type ListAppsOptions = BasicListOptions

export async function listApplications(opts: ListAppsOptions = {}): Promise<ListResult<ApplicationVM>> {
  const normalized = normalizeListOptions(opts)
  const out: ApplicationVM[] = []
  const rq = newRq(SERVICE_METHODS.list.rq)
  const queryString = toJsonString(normalized.query) ?? '{}'
  ;(rq.setQuery?.bind(rq) ?? ((_:string)=>{}))(queryString)
  const optPayload = buildOptionsPayload(normalized)
  const optionsString = toJsonString(optPayload) ?? (typeof normalized.options === 'undefined' ? '{}' : undefined)
  if (optionsString) {
    ;(rq.setOptions?.bind(rq) ?? ((_:string)=>{}))(optionsString)
  }

  await stream(
    clientFactory,
    pickMethod(clientFactory(), SERVICE_METHODS.list.method),
    rq,
    (m: any) => {
      // GetApplicationsRsp → repeated Application applications
      let arr: any[] = []
      for (const g of SERVICE_METHODS.list.rspListGetter) {
        const fn = m?.[g]
        const v = typeof fn === 'function' ? fn.call(m) : m?.[g]
        if (Array.isArray(v) && v.length) { arr = v; break }
      }
      if (arr && arr.length) out.push(...arr.map(toApplicationVM))
    },
    SERVICE_NAME
  )
  const total = out.length
  const limit = typeof normalized.pageSize === "number" && normalized.pageSize > 0 ? normalized.pageSize : undefined
  let items = out
  if (limit !== undefined) {
    const start = typeof normalized.offset === "number" ? Math.max(0, normalized.offset)
      : (typeof normalized.page === "number" && normalized.page >= 0 ? normalized.page * limit : 0)
    items = out.slice(start, start + limit)
  }
  return withListResult(items, total)
}

export type CreateApplicationInput = Partial<Pick<ApplicationVM,
  'id'|'name'|'domain'|'password'|'path'|'version'|'description'|'actions'|
  'keywords'|'icon'|'alias'|'publisherId'
>>

export async function createApplication(input: CreateApplicationInput): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.create.rq)

  // rq.application = new Application()
  const app = (() => {
    const Ctor: any = (resource as any).Application
    return typeof Ctor === 'function' ? new Ctor() : {}
  })()

  if (input.id)          app.setId?.(input.id)
  if (input.name)        app.setName?.(input.name)
  if (input.domain)      app.setDomain?.(input.domain)
  if (input.password)    app.setPassword?.(input.password)
  if (input.path)        app.setPath?.(input.path)
  if (input.version)     app.setVersion?.(input.version)
  if (input.description) app.setDescription?.(input.description)
  if (input.actions)     app.setActionsList?.(input.actions)
  if (input.keywords)    app.setKeywordsList?.(input.keywords)
  if (input.icon)        app.setIcon?.(input.icon)
  if (input.alias)       app.setAlias?.(input.alias)
  if (input.publisherId) app.setPublisherid?.(input.publisherId)

  rq.setApplication?.(app)
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.create.method), rq, undefined, md)
}

export type UpdateApplicationInput = {
  applicationId: string
  // values can be a JSON string that backend expects (resource.UpdateApplicationRqst.values)
  values: string
}
export async function updateApplication(input: UpdateApplicationInput): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.update.rq)
  rq.setApplicationid?.(input.applicationId)
  rq.setValues?.(input.values ?? '{}')
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.update.method), rq, undefined, md)
}

export async function deleteApplication(applicationId: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.delete.rq)
  rq.setApplicationid?.(applicationId)
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.delete.method), rq, undefined, md)
}

export async function addApplicationActions(applicationId: string, actions: string[]): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.addActions.rq)
  rq.setApplicationid?.(applicationId)
  rq.setActionsList?.(actions ?? [])
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.addActions.method), rq, undefined, md)
}

export async function removeApplicationAction(applicationId: string, action: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.removeAction.rq)
  rq.setApplicationid?.(applicationId)
  rq.setAction?.(action)
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.removeAction.method), rq, undefined, md)
}

export async function removeApplicationsAction(action: string): Promise<void> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.removeAllAction.rq)
  rq.setAction?.(action)
  await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.removeAllAction.method), rq, undefined, md)
}

export async function getApplicationVersion(applicationId: string): Promise<string> {
  const md = await meta()
  const rq = newRq(SERVICE_METHODS.getVersion.rq)
  rq.setId?.(applicationId)
  const rsp: any = await unary(clientFactory, pickMethod(clientFactory(), SERVICE_METHODS.getVersion.method), rq, undefined, md)
  const v = rsp?.getVersion?.() ?? rsp?.version ?? ''
  return String(v ?? '')
}

// ============================================================================
// Applications Manager (run/stop/restart & misc controls)
// ============================================================================
const APPMGR_METHODS = {
  start:   { method: ['startApplication', 'StartApplication'], rq: ['StartApplicationRequest', 'StartApplicationRqst'] },
  stop:    { method: ['stopApplication',  'StopApplication' ], rq: ['StopApplicationRequest',  'StopApplicationRqst' ] },
  restart: { method: ['restartApplication','RestartApplication'], rq: ['RestartApplicationRequest','RestartApplicationRqst'] },
  status:  { method: ['getApplicationStatus','GetApplicationStatus'], rq: ['GetApplicationStatusRequest','GetApplicationStatusRqst'] },
  // add other app manager ops here if your proto has them (e.g., setConfig, tailLogs, etc.)
} as const

export async function startApplication(applicationId: string): Promise<void> {
  const md = await meta()
  const c = appMgrClient()
  const rq = newRqIn(appmgr, APPMGR_METHODS.start.rq)
  rq.setApplicationid?.(applicationId)
  rq.setId?.(applicationId)
  await unary(() => c, pickMethod(c, APPMGR_METHODS.start.method), rq, undefined, md)
}
export async function stopApplication(applicationId: string): Promise<void> {
  const md = await meta()
  const c = appMgrClient()
  const rq = newRqIn(appmgr, APPMGR_METHODS.stop.rq)
  rq.setApplicationid?.(applicationId)
  rq.setId?.(applicationId)
  await unary(() => c, pickMethod(c, APPMGR_METHODS.stop.method), rq, undefined, md)
}
export async function restartApplication(applicationId: string): Promise<void> {
  const md = await meta()
  const c = appMgrClient()
  const rq = newRqIn(appmgr, APPMGR_METHODS.restart.rq)
  rq.setApplicationid?.(applicationId)
  rq.setId?.(applicationId)
  await unary(() => c, pickMethod(c, APPMGR_METHODS.restart.method), rq, undefined, md)
}
export async function getApplicationStatus(applicationId: string): Promise<string | number> {
  const md = await meta()
  const c = appMgrClient()
  const rq = newRqIn(appmgr, APPMGR_METHODS.status.rq)
  rq.setApplicationid?.(applicationId)
  rq.setId?.(applicationId)
  const rsp: any = await unary(() => c, pickMethod(c, APPMGR_METHODS.status.method), rq, undefined, md)
  return rsp?.getStatus?.() ?? rsp?.status ?? ''
}

// ============================================================================
// Discovery (install / uninstall on a node/peer)
// ============================================================================
const DISCOVERY_METHODS = {
  install:   { method: ['installApplication','InstallApplication'], rq: ['InstallApplicationRequest','InstallApplicationRqst'] },
  uninstall: { method: ['uninstallApplication','UninstallApplication'], rq: ['UninstallApplicationRequest','UninstallApplicationRqst'] },
} as const

export type InstallApplicationInput = {
  applicationId: string
  version?: string
  // target peer/node; field names vary across builds: peer, host, address, hostname, ip...
  target?: string
  // optional JSON or key-values your backend may support
  options?: string
}

export async function installApplication(input: InstallApplicationInput): Promise<void> {
  const md = await meta()
  const c = discoveryClient()
  const rq = newRqIn(discovery, DISCOVERY_METHODS.install.rq)
  rq.setApplicationid?.(input.applicationId)
  rq.setId?.(input.applicationId)
  if (input.version) rq.setVersion?.(input.version)
  if (input.options) rq.setOptions?.(input.options)

  // Best-effort: map "target" to the most likely field names
  const t = input.target
  rq.setPeer?.(t); rq.setHost?.(t); rq.setAddress?.(t); rq.setHostname?.(t); rq.setIp?.(t); rq.setTarget?.(t)

  await unary(() => c, pickMethod(c, DISCOVERY_METHODS.install.method), rq, undefined, md)
}

export async function uninstallApplication(applicationId: string, target?: string): Promise<void> {
  const md = await meta()
  const c = discoveryClient()
  const rq = newRqIn(discovery, DISCOVERY_METHODS.uninstall.rq)
  rq.setApplicationid?.(applicationId)
  rq.setId?.(applicationId)
  const t = target
  rq.setPeer?.(t); rq.setHost?.(t); rq.setAddress?.(t); rq.setHostname?.(t); rq.setIp?.(t); rq.setTarget?.(t)
  await unary(() => c, pickMethod(c, DISCOVERY_METHODS.uninstall.method), rq, undefined, md)
}

// ============================================================================
// Repository (publish + bundle upload/download)
// ============================================================================
const REPO_METHODS = {
  publish: { method: ['publishApplication','PublishApplication'], rq: ['PublishApplicationRequest','PublishApplicationRqst'] },
  upload:  { method: ['uploadBundle','UploadBundle'], rq: ['UploadBundleRequest','UploadBundleRqst'] },
  download:{ method: ['downloadBundle','DownloadBundle'], rq: ['DownloadBundleRequest','DownloadBundleRqst'] },
} as const

export type PublishApplicationInput = {
  applicationId: string
  version?: string
  notes?: string
  keywords?: string[]
  visibility?: 'public' | 'private' | string
}

export async function publishApplication(input: PublishApplicationInput): Promise<void> {
  const md = await meta()
  const c = repositoryClient()
  const rq = newRqIn(repo, REPO_METHODS.publish.rq)
  rq.setApplicationid?.(input.applicationId)
  rq.setId?.(input.applicationId)
  if (input.version) rq.setVersion?.(input.version)
  if (input.notes) rq.setNotes?.(input.notes)
  if (Array.isArray(input.keywords)) rq.setKeywordsList?.(input.keywords)
  if (input.visibility) rq.setVisibility?.(input.visibility)
  await unary(() => c, pickMethod(c, REPO_METHODS.publish.method), rq, undefined, md)
}

export type UploadBundleInput = {
  bytes: Uint8Array | ArrayBuffer
  filename?: string
  applicationId?: string
  version?: string
  contentType?: string
}

export async function uploadBundle(input: UploadBundleInput): Promise<void> {
  const md = await meta()
  const c = repositoryClient()
  const rq = newRqIn(repo, REPO_METHODS.upload.rq)

  // data
  const data = input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : input.bytes
  rq.setData?.(data)                 // bytes
  rq.setContent?.(data)              // some codegens use "content"
  // meta
  if (input.filename) rq.setFilename?.(input.filename)
  if (input.applicationId) { rq.setApplicationid?.(input.applicationId); rq.setId?.(input.applicationId) }
  if (input.version) rq.setVersion?.(input.version)
  if (input.contentType) rq.setContenttype?.(input.contentType)

  await unary(() => c, pickMethod(c, REPO_METHODS.upload.method), rq, undefined, md)
}

export type DownloadBundleInput = {
  applicationId: string
  version?: string
}

export async function downloadBundle(input: DownloadBundleInput): Promise<Uint8Array> {
  const md = await meta()
  const c = repositoryClient()
  const rq = newRqIn(repo, REPO_METHODS.download.rq)
  rq.setApplicationid?.(input.applicationId)
  rq.setId?.(input.applicationId)
  if (input.version) rq.setVersion?.(input.version)

  const rsp: any = await unary(() => c, pickMethod(c, REPO_METHODS.download.method), rq, undefined, md)
  // try common response fields
  const data =
    rsp?.getData?.() ??
    rsp?.getContent?.() ??
    rsp?.data ??
    rsp?.content ??
    new Uint8Array()
  return data as Uint8Array
}
