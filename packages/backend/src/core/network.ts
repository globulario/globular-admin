// src/backend/core/network.ts
import { getConfig, requireBaseUrl, grpcWebHostUrl } from './endpoints'
import { unary } from './rpc'

import * as adminGrpc from 'globular-web-client/admin/admin_grpc_web_pb'
import * as clustercontrollerpb from 'globular-web-client/clustercontroller/clustercontroller_pb'

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

function client(): adminGrpc.AdminServiceClient {
  const addr = grpcWebHostUrl()
  return new adminGrpc.AdminServiceClient(addr, null, { withCredentials: true })
}

async function metadata(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem('__globular_token__')
    return t ? { token: t } : {}
  } catch { return {} }
}

/**
 * Fetch a summary of network settings from the backend.
 *
 * Hostname comes from AdminService.listNodes → first node's NodeIdentity.
 * IPs from NodeIdentity.ips are mapped to Iface entries.
 * Falls back to /config for hostname when listNodes is unavailable.
 * DNS servers and default gateway are not exposed by the current API.
 */
export async function fetchNetworkSummary(): Promise<NetworkSummary> {
  const c = client()
  const md = await metadata()

  let hostname: string = location.hostname
  let interfaces: Iface[] = []

  try {
    const rq = new clustercontrollerpb.ListNodesRequest()
    const rsp = await unary<
      clustercontrollerpb.ListNodesRequest,
      clustercontrollerpb.ListNodesResponse
    >(() => c, 'listNodes', rq, undefined, md)

    const nodes = rsp.getNodesList()
    if (nodes.length > 0) {
      const identity = nodes[0].getIdentity()
      if (identity) {
        hostname = identity.getHostname() || hostname
        const ips = identity.getIpsList()
        interfaces = ips
          .filter(ip => !!ip)
          .map(ip => ({
            name: ip,
            ipv4: !ip.includes(':') ? [ip] : [],
            ipv6: ip.includes(':') ? [ip] : [],
          } satisfies Iface))
      }
    }
  } catch {
    // listNodes failing is non-fatal; fall back to /config for hostname
    const cfg = await getConfig()
    if (cfg) hostname = (cfg as any).Name || hostname
  }

  // DNS servers and default gateway are not available from the current API
  return { hostname, interfaces, dnsServers: [] }
}

// Apply changes. Keep small and composable so you can gate each call with RBAC.
export type NetworkUpdate = Partial<{
  hostname: string
  dnsServers: string[]
}>

/**
 * Persist network settings.
 *
 * Note: the current AdminService API does not expose hostname or DNS
 * as writable fields. This function is a stub — implement once the
 * backend provides an appropriate RPC (e.g. UpdateClusterNetwork).
 */
export async function applyNetworkUpdate(_update: NetworkUpdate): Promise<void> {
  // TODO: implement when backend exposes UpdateClusterNetwork or equivalent
  throw new Error('applyNetworkUpdate: not yet implemented — no backend RPC available')
}
