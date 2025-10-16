// src/backend/core/network.ts
import { getBaseUrl } from './endpoints'
import { unary } from './rpc'

// Adjust these imports to your actual generated packages
// (examples shown; replace with your real service)
import { AdminServiceClient } from 'globular-web-client/admin/admin_grpc_web_pb'
import * as adminpb from 'globular-web-client/admin/admin_pb'

export type Iface = {
  name: string
  mac?: string
  ipv4?: string[]
  ipv6?: string[]
  up?: boolean
  mtu?: number
}

export type NetworkSummary = {
  hostname: string
  interfaces: Iface[]
  dnsServers: string[]
  defaultGateway?: string
}

function client(): AdminServiceClient {
  const addr = getBaseUrl() ?? ''
  return new AdminServiceClient(addr, null, { withCredentials: true })
}

async function metadata(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch { return {} }
}

/**
 * Fetch a summary of network settings from backend.
 * TODO: Replace request/response with your exact proto classes.
 */
export async function fetchNetworkSummary(): Promise<NetworkSummary> {
  const c = client()
  const md = await metadata()

  // Support two common generator names (adjust to your build)
  const Rq = (adminpb as any).GetNetworkInfoRqst || (adminpb as any).getNetworkInfoRequest
  const rq = Rq ? new Rq() : {}

  const rsp: any = await unary(() => c, 'getNetworkInfo', rq, undefined, md)

  // Try both accessor styles
  const hostname: string =
    typeof rsp.getHostname === 'function' ? rsp.getHostname() : (rsp.hostname || location.hostname)

  const dns: string[] =
    typeof rsp.getDnsServersList === 'function' ? rsp.getDnsServersList() : (rsp.dnsServers || [])

  const gw: string | undefined =
    typeof rsp.getDefaultGateway === 'function' ? rsp.getDefaultGateway() : rsp.defaultGateway

  const list: any[] =
    typeof rsp.getInterfacesList === 'function' ? rsp.getInterfacesList() : (rsp.interfaces || [])

  const interfaces: Iface[] = list.map((i: any) => ({
    name: call(i, 'getName') ?? '',
    mac: call(i, 'getMac'),
    ipv4: callArr(i, 'getIpv4List'),
    ipv6: callArr(i, 'getIpv6List'),
    up: callBool(i, 'getUp'),
    mtu: callNum(i, 'getMtu'),
  }))

  return { hostname, interfaces, dnsServers: dns, defaultGateway: gw }
}

// Apply changes. Keep small and composable so you can gate each call with RBAC.
export type NetworkUpdate = Partial<{
  hostname: string
  dnsServers: string[]
}>

/**
 * Persist a subset of network settings.
 * TODO: Replace with your real proto/method(s) or split per-field as needed.
 */
export async function applyNetworkUpdate(update: NetworkUpdate): Promise<void> {
  const c = client()
  const md = await metadata()

  const Rq = (adminpb as any).UpdateNetworkInfoRqst || (adminpb as any).updateNetworkInfoRequest
  const rq: any = Rq ? new Rq() : {}

  if (update.hostname && typeof rq.setHostname === 'function') rq.setHostname(update.hostname)
  if (update.dnsServers && typeof rq.setDnsServersList === 'function') rq.setDnsServersList(update.dnsServers)

  await unary(() => c, 'updateNetworkInfo', rq, '', md)
}

/* ----------------- small helpers to read optional getters ----------------- */
function call(obj: any, getter: string): string | undefined {
  return typeof obj?.[getter] === 'function' ? obj[getter]() : obj?.[getter.replace(/^get/i, '')]
}
function callArr(obj: any, getter: string): string[] {
  const v = typeof obj?.[getter] === 'function' ? obj[getter]() : obj?.[getter.replace(/^get/i, '')]
  return Array.isArray(v) ? v : (v ? [String(v)] : [])
}
function callBool(obj: any, getter: string): boolean | undefined {
  const v = typeof obj?.[getter] === 'function' ? obj[getter]() : obj?.[getter.replace(/^get/i, '')]
  return typeof v === 'boolean' ? v : undefined
}
function callNum(obj: any, getter: string): number | undefined {
  const v = typeof obj?.[getter] === 'function' ? obj[getter]() : obj?.[getter.replace(/^get/i, '')]
  return typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : undefined)
}
