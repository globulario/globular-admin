// packages/backend/src/cluster/cluster.ts
import { unary } from '../core/rpc'
import { serviceSubdomainUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import { ClusterControllerServiceClient } from 'globular-web-client/clustercontroller/clustercontroller_grpc_web_pb'
import * as cc from 'globular-web-client/clustercontroller/clustercontroller_pb'

function ccClient(): ClusterControllerServiceClient {
  const addr = serviceSubdomainUrl('clustercontroller.ClusterControllerService')
  return new ClusterControllerServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NodeHealth {
  nodeId: string
  hostname: string
  /** Raw status string from the proto, e.g. "HEALTHY", "DEGRADED", "UNREACHABLE" */
  status: string
  failedChecks: string[]
  lastSeen: number
  lastError: string
}

export interface ClusterHealth {
  clusterId: string
  clusterDomain: string
  totalNodes: number
  healthyNodes: number
  unhealthyNodes: number
  unknownNodes: number
  /** Overall cluster status string */
  status: string
  nodes: NodeHealth[]
}

export interface ClusterNode {
  nodeId: string
  hostname: string
  ips: string[]
  /** Reported operational status */
  status: string
  appliedServicesHash: string
  inventoryComplete: boolean
  lastSeen: number
  lastError: string
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function getClusterHealth(): Promise<ClusterHealth> {
  const md = metadata()

  // GetClusterInfo provides cluster_id and cluster_domain (separate RPC from health).
  // Run both calls concurrently; if ClusterInfo fails we fall back to empty strings.
  // GetClusterInfo takes google.protobuf.Timestamp — an empty Timestamp (all-zero
  // seconds/nanos) serializes to an empty byte array, which the server accepts.
  // We avoid importing google-protobuf directly (not a direct dep; Vite can't resolve it).
  const infoRq = { serializeBinary: (): Uint8Array => new Uint8Array(0) } as any
  const healthRq = new cc.GetClusterHealthRequest()

  const [infoRsp, rsp] = await Promise.all([
    unary<any, cc.ClusterInfo>(ccClient, 'getClusterInfo', infoRq, undefined, md)
      .catch(() => null),
    unary<cc.GetClusterHealthRequest, cc.GetClusterHealthResponse>(
      ccClient, 'getClusterHealth', healthRq, undefined, md,
    ),
  ])

  return {
    clusterId:      infoRsp?.getClusterId()     ?? '',
    clusterDomain:  infoRsp?.getClusterDomain() ?? '',
    totalNodes:     rsp.getTotalNodes(),
    healthyNodes:   rsp.getHealthyNodes(),
    unhealthyNodes: rsp.getUnhealthyNodes(),
    unknownNodes:   rsp.getUnknownNodes(),
    status:         rsp.getStatus(),
    nodes: rsp.getNodeHealthList().map((n: any) => ({
      nodeId:        n.getNodeId?.()       ?? '',
      hostname:      n.getHostname?.()     ?? '',
      status:        n.getStatus?.()       ?? '',
      failedChecks:  n.getFailedChecks?.() ?? [],
      lastSeen:      n.getLastSeen?.()     ?? 0,
      lastError:     n.getLastError?.()    ?? '',
    } satisfies NodeHealth)),
  }
}

export async function listClusterNodes(): Promise<ClusterNode[]> {
  const md = metadata()
  const rq = new cc.ListNodesRequest()
  const rsp = await unary<cc.ListNodesRequest, cc.ListNodesResponse>(
    ccClient, 'listNodes', rq, undefined, md,
  )
  return rsp.getNodesList().map((n: any) => {
    const identity = n.getIdentity?.()
    return {
      nodeId:               identity?.getNodeId?.()       ?? n.getNodeId?.() ?? '',
      hostname:             identity?.getHostname?.()     ?? '',
      ips:                  identity?.getIpsList?.()      ?? [],
      status:               n.getStatus?.()               ?? '',
      appliedServicesHash:  n.getAppliedServicesHash?.()  ?? '',
      inventoryComplete:    n.getInventoryComplete?.()    ?? true,
      lastSeen:             n.getLastSeen?.()             ?? 0,
      lastError:            n.getLastError?.()            ?? '',
    } satisfies ClusterNode
  })
}
