// src/backend/core/network.ts
import { getConfig, requireBaseUrl, grpcWebHostUrl } from './endpoints'
import { unary } from './rpc'
import { metadata } from './auth'

import * as clusterGrpc from 'globular-web-client/cluster_controller/cluster_controller_grpc_web_pb'
import * as clustercontrollerpb from 'globular-web-client/cluster_controller/cluster_controller_pb'

function ccClient(): clusterGrpc.ClusterControllerServiceClient {
  return new clusterGrpc.ClusterControllerServiceClient(
    grpcWebHostUrl(), null, { withCredentials: true }
  )
}

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

/**
 * Fetch a summary of network settings from the backend.
 *
 * Hostname and IPs come from ClusterController.listNodes → first node's NodeIdentity.
 * Falls back to /config for hostname when listNodes is unavailable.
 * DNS servers are not readable from the current API (writable via applyNetworkUpdate).
 */
export async function fetchNetworkSummary(): Promise<NetworkSummary> {
  const md = metadata()

  let hostname: string = location.hostname
  let interfaces: Iface[] = []

  try {
    const rq = new clustercontrollerpb.ListNodesRequest()
    const rsp = await unary<
      clustercontrollerpb.ListNodesRequest,
      clustercontrollerpb.ListNodesResponse
    >(ccClient, 'listNodes', rq, undefined, md)

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
            ipv6: ip.includes(':')  ? [ip] : [],
          } satisfies Iface))
      }
    }
  } catch {
    // listNodes failing is non-fatal; fall back to /config for hostname
    const cfg = await getConfig()
    if (cfg) hostname = (cfg as any).Name || hostname
  }

  return { hostname, interfaces, dnsServers: [] }
}

// Apply changes. Keep small and composable so you can gate each call with RBAC.
export type NetworkUpdate = Partial<{
  /** DNS nameservers to set cluster-wide via UpdateClusterNetwork. */
  dnsServers: string[]
}>

/**
 * Persist network settings via the ClusterController's UpdateClusterNetwork RPC.
 *
 * Only `dnsServers` is writable. Hostname is a read-only node-level value
 * that cannot be changed through the cluster API.
 *
 * The server requires `cluster_domain` in the spec. We read it from
 * `getClusterInfo` and preserve the current protocol from the base URL.
 * All other spec fields (ACME, ports, etc.) should be set via the cluster
 * network configuration page, not here.
 */
export async function applyNetworkUpdate(update: NetworkUpdate): Promise<void> {
  if (!update.dnsServers || update.dnsServers.length === 0) return

  const md = metadata()

  // getClusterInfo takes google.protobuf.Timestamp — empty bytes (same trick as cluster.ts)
  const infoRq = { serializeBinary: (): Uint8Array => new Uint8Array(0) } as any
  let clusterDomain = ''
  try {
    const infoRsp = await unary<any, clustercontrollerpb.ClusterInfo>(
      ccClient, 'getClusterInfo', infoRq, undefined, md,
    )
    clusterDomain = infoRsp.getClusterDomain?.() ?? ''
  } catch { /* fall through to base-URL fallback */ }

  if (!clusterDomain) {
    // Last resort: extract from base URL (e.g. https://globular.cloud → globular.cloud)
    try { clusterDomain = new URL(requireBaseUrl()).hostname } catch { /* leave empty */ }
  }

  if (!clusterDomain) {
    throw new Error('Cannot determine cluster domain. Configure the cluster network first.')
  }

  // Infer protocol from the base URL so we don't accidentally downgrade to http
  let protocol = 'https'
  try { protocol = new URL(requireBaseUrl()).protocol.replace(':', '') } catch { /* keep https */ }

  const spec = new clustercontrollerpb.ClusterNetworkSpec()
  spec.setClusterDomain(clusterDomain)
  spec.setProtocol(protocol)
  if (protocol === 'http') spec.setPortHttp(80)
  else spec.setPortHttps(443)
  spec.setDnsNameserversList(update.dnsServers)

  const rq = new clustercontrollerpb.UpdateClusterNetworkRequest()
  rq.setSpec(spec)

  await unary<
    clustercontrollerpb.UpdateClusterNetworkRequest,
    clustercontrollerpb.UpdateClusterNetworkResponse
  >(ccClient, 'updateClusterNetwork', rq, undefined, md)
}
