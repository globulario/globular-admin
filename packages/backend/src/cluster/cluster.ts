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
  const rq = new cc.GetClusterHealthRequest()
  const rsp = await unary<cc.GetClusterHealthRequest, cc.GetClusterHealthResponse>(
    ccClient, 'getClusterHealth', rq, undefined, md,
  )
  return {
    clusterId: rsp.getClusterId(),
    clusterDomain: rsp.getClusterDomain(),
    totalNodes: rsp.getTotalNodes(),
    healthyNodes: rsp.getHealthyNodes(),
    unhealthyNodes: rsp.getUnhealthyNodes(),
    unknownNodes: rsp.getUnknownNodes(),
    status: rsp.getStatus(),
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
