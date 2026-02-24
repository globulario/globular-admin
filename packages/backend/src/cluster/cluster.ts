// packages/backend/src/cluster/cluster.ts
import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as clusterGrpc from 'globular-web-client/clustercontroller/clustercontroller_grpc_web_pb'
import * as cc from 'globular-web-client/clustercontroller/clustercontroller_pb'
import * as planPb from 'globular-web-client/clustercontroller/plan_pb'

function ccClient(): clusterGrpc.ClusterControllerServiceClient {
  const addr = grpcWebHostUrl()
  return new clusterGrpc.ClusterControllerServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NodeCapabilities {
  cpuCount: number
  ramBytes: number
  diskBytes: number
  diskFreeBytes: number
}

export interface NodeHealth {
  nodeId: string
  hostname: string
  /** Raw status string from the proto, e.g. "HEALTHY", "DEGRADED", "UNREACHABLE" */
  status: string
  failedChecks: number
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
  profiles: string[]
  /** Reported operational status */
  status: string
  appliedServicesHash: string
  inventoryComplete: boolean
  lastSeen: number
  lastError: string
  capabilities: NodeCapabilities | null
}

export interface JoinRequest {
  requestId: string
  hostname: string
  domain: string
  ips: string[]
  os: string
  arch: string
  agentVersion: string
  nodeName: string
  status: string
  message: string
  profiles: string[]
  suggestedProfiles: string[]
  capabilities: NodeCapabilities | null
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
      failedChecks:  n.getFailedChecks?.() ?? 0,
      lastSeen:      n.getLastSeen?.()?.getSeconds?.() ?? 0,
      lastError:     n.getLastError?.()    ?? '',
    } satisfies NodeHealth)),
  }
}

export async function listJoinRequests(): Promise<JoinRequest[]> {
  const md = metadata()
  const rq = new cc.ListJoinRequestsRequest()
  const rsp = await unary<cc.ListJoinRequestsRequest, cc.ListJoinRequestsResponse>(
    ccClient, 'listJoinRequests', rq, undefined, md,
  )
  return rsp.getPendingList().map((r: any) => {
    const id = r.getIdentity?.()
    const rawCaps = r.getCapabilities?.()
    return {
      requestId:         r.getRequestId?.()             ?? '',
      hostname:          id?.getHostname?.()             ?? '',
      domain:            id?.getDomain?.()               ?? '',
      ips:               id?.getIpsList?.()              ?? [],
      os:                id?.getOs?.()                   ?? '',
      arch:              id?.getArch?.()                 ?? '',
      agentVersion:      id?.getAgentVersion?.()         ?? '',
      nodeName:          id?.getNodeName?.()             ?? '',
      status:            r.getStatus?.()                 ?? '',
      message:           r.getMessage?.()                ?? '',
      profiles:          r.getProfilesList?.()           ?? [],
      suggestedProfiles: r.getSuggestedProfilesList?.()  ?? [],
      capabilities: rawCaps ? {
        cpuCount:      rawCaps.getCpuCount?.()      ?? 0,
        ramBytes:      rawCaps.getRamBytes?.()      ?? 0,
        diskBytes:     rawCaps.getDiskBytes?.()     ?? 0,
        diskFreeBytes: rawCaps.getDiskFreeBytes?.() ?? 0,
      } : null,
    } satisfies JoinRequest
  })
}

export async function approveJoin(requestId: string, profiles: string[]): Promise<string> {
  const md = metadata()
  const rq = new cc.ApproveJoinRequest()
  rq.setRequestId(requestId)
  rq.setProfilesList(profiles)
  const rsp = await unary<cc.ApproveJoinRequest, cc.ApproveJoinResponse>(
    ccClient, 'approveJoin', rq, undefined, md,
  )
  return rsp.getNodeId?.() ?? ''
}

export async function rejectJoin(requestId: string, reason: string): Promise<void> {
  const md = metadata()
  const rq = new cc.RejectJoinRequest()
  rq.setRequestId(requestId)
  rq.setReason(reason)
  await unary<cc.RejectJoinRequest, cc.RejectJoinResponse>(
    ccClient, 'rejectJoin', rq, undefined, md,
  )
}

export async function createJoinToken(): Promise<{ token: string; expiresAt: string }> {
  const md = metadata()
  const rq = new cc.CreateJoinTokenRequest()
  const rsp = await unary<cc.CreateJoinTokenRequest, cc.CreateJoinTokenResponse>(
    ccClient, 'createJoinToken', rq, undefined, md,
  )
  const ts = rsp.getExpiresAt?.()
  const expiresAt = ts
    ? new Date(ts.getSeconds() * 1000).toLocaleString()
    : ''
  return { token: rsp.getJoinToken?.() ?? '', expiresAt }
}

export async function setNodeProfiles(nodeId: string, profiles: string[]): Promise<void> {
  const md = metadata()
  const rq = new cc.SetNodeProfilesRequest()
  rq.setNodeId(nodeId)
  rq.setProfilesList(profiles)
  await unary<cc.SetNodeProfilesRequest, cc.SetNodeProfilesResponse>(
    ccClient, 'setNodeProfiles', rq, undefined, md,
  )
}

export async function listClusterNodes(): Promise<ClusterNode[]> {
  const md = metadata()
  const rq = new cc.ListNodesRequest()
  const rsp = await unary<cc.ListNodesRequest, cc.ListNodesResponse>(
    ccClient, 'listNodes', rq, undefined, md,
  )
  return rsp.getNodesList().map((n: any) => {
    const identity = n.getIdentity?.()
    const rawCaps = n.getCapabilities?.()
    return {
      nodeId:               identity?.getNodeId?.()       ?? n.getNodeId?.() ?? '',
      hostname:             identity?.getHostname?.()     ?? '',
      ips:                  identity?.getIpsList?.()      ?? [],
      profiles:             n.getProfilesList?.()         ?? [],
      status:               n.getStatus?.()               ?? '',
      appliedServicesHash:  n.getAppliedServicesHash?.()  ?? '',
      inventoryComplete:    n.getInventoryComplete?.()    ?? true,
      lastSeen:             n.getLastSeen?.()?.getSeconds?.() ?? 0,
      lastError:            n.getLastError?.()            ?? '',
      capabilities: rawCaps ? {
        cpuCount:      rawCaps.getCpuCount?.()      ?? 0,
        ramBytes:      rawCaps.getRamBytes?.()      ?? 0,
        diskBytes:     rawCaps.getDiskBytes?.()     ?? 0,
        diskFreeBytes: rawCaps.getDiskFreeBytes?.() ?? 0,
      } : null,
    } satisfies ClusterNode
  })
}

// ─── Node Plan ────────────────────────────────────────────────────────────────

export interface DesiredServiceVM {
  name:    string
  version: string
  unit:    string
}

export interface NodeServicePlan {
  nodeId:     string
  planId:     string
  generation: number
  services:   DesiredServiceVM[]
}

/** Fetch the desired-state plan for a single node from ClusterController. */
export async function getNodePlan(nodeId: string): Promise<NodeServicePlan | null> {
  try {
    const md = metadata()
    const rq = new cc.GetNodePlanV1Request()
    rq.setNodeId(nodeId)
    const rsp: any = await unary<cc.GetNodePlanV1Request, cc.GetNodePlanV1Response>(
      ccClient, 'getNodePlanV1', rq, undefined, md,
    )
    const plan: planPb.NodePlan | undefined = rsp?.getPlan?.()
    const desired = plan?.getSpec?.()?.getDesired?.()
    const services: DesiredServiceVM[] = (desired?.getServicesList?.() ?? []).map((s: any) => ({
      name:    s.getName?.()    ?? '',
      version: s.getVersion?.() ?? '',
      unit:    s.getUnit?.()    ?? '',
    }))
    return {
      nodeId,
      planId:     plan?.getPlanId?.()     ?? '',
      generation: plan?.getGeneration?.() ?? 0,
      services,
    }
  } catch {
    return null
  }
}
