// src/backend/peers.ts
import { getBaseUrl } from '../core/endpoints'
import { unary, stream } from '../core/rpc'

// ---- Generated stubs (adjust import paths if needed) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"

import { AdminServiceClient } from "globular-web-client/admin/admin_grpc_web_pb"
import * as admin from "globular-web-client/admin/admin_pb"

// Peer VM aligned to resource.Peer
export type PeerVM = {
  hostname?: string
  domain?: string
  externalIpAddress?: string
  localIpAddress?: string
  mac: string
  portHttp?: number
  portHttps?: number
  protocol?: string
  state?: number | string
  actions?: string[]
  typeName?: string
}

export type DiscoveredHost = {
  name: string
  ip: string
  mac: string
  infos?: string
}

// ------------------------------ clients / meta ------------------------------
function resourceClient(): ResourceServiceClient {
  const base = getBaseUrl() ?? ''
  return new ResourceServiceClient(base, null, { withCredentials: true })
}
function adminClient(): AdminServiceClient {
  const base = getBaseUrl() ?? ''
  return new AdminServiceClient(base, null, { withCredentials: true })
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
function newRq(names: readonly string[], ns: any): any {
  for (const n of names) {
    const Ctor: any = ns[n]
    if (typeof Ctor === 'function') return new Ctor()
  }
  return {}
}
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

// ------------------------------ mapping ------------------------------
export function toPeerVM(p: any): PeerVM {
  if (!p) return { mac: '' }

  return {
    hostname:         getStr(p, ['getHostname', 'hostname'], ''),
    domain:           getStr(p, ['getDomain', 'domain'], ''),
    externalIpAddress:getStr(p, ['getExternalIpAddress','getExternalIpaddress','externalIpAddress'], ''),
    localIpAddress:   getStr(p, ['getLocalIpAddress','getLocalIpaddress','localIpAddress'], ''),
    mac:              getStr(p, ['getMac','mac'], ''),
    portHttp:         getNum(p, ['getPorthttp','getPortHttp','portHttp'], 0),
    portHttps:        getNum(p, ['getPorthttps','getPortHttps','portHttps'], 0),
    protocol:         getStr(p, ['getProtocol','protocol'], ''),
    state:            getNum(p, ['getState','state'], 0),
    actions:          getArr(p, ['getActionsList','actions']),
    typeName:         getStr(p, ['getTypename','getTypeName','typeName'], ''),
  }
}

// ------------------------------ service methods ------------------------------
const SERVICE_NAME = 'resource.ResourceService' as const

const METHODS = {
  list: { method: ['getPeers'], rq: ['GetPeersRqst'], rspListGetter: ['getPeersList','peers'] },
  register: { method: ['registerPeer'], rq: ['RegisterPeerRqst'] },
  update: { method: ['updatePeer'], rq: ['UpdatePeerRqst'] },
  delete: { method: ['deletePeer'], rq: ['DeletePeerRqst'] },
  addActions: { method: ['addPeerActions'], rq: ['AddPeerActionsRqst'] },
  removeAction: { method: ['removePeerAction'], rq: ['RemovePeerActionRqst'] },
  removeAllAction: { method: ['removePeersAction'], rq: ['RemovePeersActionRqst'] },
  approval: { method: ['getPeerApprovalState'], rq: ['GetPeerApprovalStateRqst'] },
  accept: { method: ['acceptPeer'], rq: ['AcceptPeerRqst'] },
  reject: { method: ['rejectPeer'], rq: ['RejectPeerRqst'] },
} as const

export type ListPeersOptions = { query?: string; options?: string }
export async function listPeers(opts: ListPeersOptions = {}): Promise<PeerVM[]> {
  const out: PeerVM[] = []
  const rq = newRq(METHODS.list.rq, resource)
  rq.setQuery?.(opts.query ?? '{}')
  rq.setOptions?.(opts.options ?? '{}')

  await stream(
    resourceClient,
    pickMethod(resourceClient(), METHODS.list.method),
    rq,
    (m: any) => {
      let arr: any[] = []
      for (const g of METHODS.list.rspListGetter) {
        const fn = m?.[g]
        const v = typeof fn === 'function' ? fn.call(m) : m?.[g]
        if (Array.isArray(v) && v.length) { arr = v; break }
      }
      if (arr && arr.length) out.push(...arr.map(toPeerVM))
    },
    SERVICE_NAME
  )
  return out
}

export type UpsertPeerInput = Partial<PeerVM> & { mac: string }

/** Register a new peer (or upsert if your backend supports it) */
export async function registerPeer(input: UpsertPeerInput & { publicKey?: string }): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.register.rq, resource)

  // peer payload
  const PeerCtor: any = (resource as any).Peer
  const peer = typeof PeerCtor === 'function' ? new PeerCtor() : {}

  if (input.hostname)       peer.setHostname?.(input.hostname)
  if (input.domain)         peer.setDomain?.(input.domain)
  if (input.externalIpAddress) peer.setExternalIpAddress?.(input.externalIpAddress)
  if (input.localIpAddress) peer.setLocalIpAddress?.(input.localIpAddress)
  if (input.mac)            peer.setMac?.(input.mac)
  if (typeof input.portHttp === 'number')  peer.setPorthttp?.(input.portHttp)
  if (typeof input.portHttps === 'number') peer.setPorthttps?.(input.portHttps)
  if (input.protocol)       peer.setProtocol?.(input.protocol)
  if (Array.isArray(input.actions)) peer.setActionsList?.(input.actions)

  rq.setPeer?.(peer)
  if (input.publicKey) rq.setPublicKey?.(input.publicKey)

  await unary(resourceClient, pickMethod(resourceClient(), METHODS.register.method), rq, undefined, md)
}

/** Update an existing peer */
export async function updatePeer(input: UpsertPeerInput): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.update.rq, resource)

  const PeerCtor: any = (resource as any).Peer
  const peer = typeof PeerCtor === 'function' ? new PeerCtor() : {}

  if (input.hostname)       peer.setHostname?.(input.hostname)
  if (input.domain)         peer.setDomain?.(input.domain)
  if (input.externalIpAddress) peer.setExternalIpAddress?.(input.externalIpAddress)
  if (input.localIpAddress) peer.setLocalIpAddress?.(input.localIpAddress)
  if (input.mac)            peer.setMac?.(input.mac)
  if (typeof input.portHttp === 'number')  peer.setPorthttp?.(input.portHttp)
  if (typeof input.portHttps === 'number') peer.setPorthttps?.(input.portHttps)
  if (input.protocol)       peer.setProtocol?.(input.protocol)
  if (Array.isArray(input.actions)) peer.setActionsList?.(input.actions)

  rq.setPeer?.(peer)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.update.method), rq, undefined, md)
}

/** Delete a peer (DeletePeerRqst expects a Peer payload) */
export async function deletePeer(mac: string): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.delete.rq, resource)
  const PeerCtor: any = (resource as any).Peer
  const peer = typeof PeerCtor === 'function' ? new PeerCtor() : {}
  peer.setMac?.(mac)
  rq.setPeer?.(peer)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.delete.method), rq, undefined, md)
}

/** Add action permissions to a peer */
export async function addPeerActions(mac: string, actions: string[]): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.addActions.rq, resource)
  rq.setMac?.(mac)
  rq.setActionsList?.(actions ?? [])
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.addActions.method), rq, undefined, md)
}

/** Remove a specific action from a peer */
export async function removePeerAction(mac: string, action: string): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.removeAction.rq, resource)
  rq.setMac?.(mac)
  rq.setAction?.(action)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.removeAction.method), rq, undefined, md)
}

/** Remove an action from all peers */
export async function removePeersAction(action: string): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.removeAllAction.rq, resource)
  rq.setAction?.(action)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.removeAllAction.method), rq, undefined, md)
}

/** Ask another peer about a given peer's approval state */
export async function getPeerApprovalState(mac: string, remotePeerAddress: string): Promise<number> {
  const md = await meta()
  const rq = newRq(METHODS.approval.rq, resource)
  rq.setMac?.(mac)
  rq.setRemotePeerAddress?.(remotePeerAddress)
  const rsp: any = await unary(resourceClient, pickMethod(resourceClient(), METHODS.approval.method), rq, undefined, md)
  const state = rsp?.getState?.() ?? rsp?.state ?? 0
  return Number(state) || 0
}

/** Accept / Reject peer */
export async function acceptPeer(mac: string): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.accept.rq, resource)
  const PeerCtor: any = (resource as any).Peer
  const peer = typeof PeerCtor === 'function' ? new PeerCtor() : {}
  peer.setMac?.(mac)
  rq.setPeer?.(peer)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.accept.method), rq, undefined, md)
}

export async function rejectPeer(mac: string): Promise<void> {
  const md = await meta()
  const rq = newRq(METHODS.reject.rq, resource)
  const PeerCtor: any = (resource as any).Peer
  const peer = typeof PeerCtor === 'function' ? new PeerCtor() : {}
  peer.setMac?.(mac)
  rq.setPeer?.(peer)
  await unary(resourceClient, pickMethod(resourceClient(), METHODS.reject.method), rq, undefined, md)
}

// ------------------------------ Admin (Discovery helpers) ------------------------------
/** Scan for available hosts via AdminService.GetAvailableHosts */
export async function getAvailableHosts(): Promise<DiscoveredHost[]> {
  const md = await meta()
  const c = adminClient()
  const rq = new (admin as any).getAvailableHostsRequest()
  const rsp: any = await unary(() => c, 'getAvailableHosts', rq, undefined, md)
  const list: any[] = rsp?.getHostsList?.() ?? rsp?.hosts ?? []
  return (list || []).map((h: any) => ({
    name:  getStr(h, ['getName','name'], ''),
    ip:    getStr(h, ['getIp','ip'], ''),
    mac:   getStr(h, ['getMac','mac'], ''),
    infos: getStr(h, ['getInfos','infos'], ''),
  }))
}

// ------------------------------ NEW: scanPeers / pingPeer ------------------------------
/** UI-friendly alias; matches previous working behavior used by peer_discovery.ts */
export async function scanPeers(): Promise<DiscoveredHost[]> {
  return getAvailableHosts()
}

/**
 * Lightweight reachability probe (browser-friendly).
 * Mirrors the previous working implementation: attempts a simple fetch to the target.
 */
export async function pingPeer(ip: string): Promise<boolean> {
  try {
    const base = getBaseUrl() || "http://localhost"
    const proto = new URL(base).protocol // keep same scheme as current backend
    // Try a harmless endpoint; even opaque/no-cors that doesn't throw counts as reachable.
    const url = `${proto}//${ip}/config`
    const res = await fetch(url, { method: 'GET', mode: 'cors' })
    return res.ok
  } catch {
    return false
  }
}
