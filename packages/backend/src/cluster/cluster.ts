// packages/backend/src/cluster/cluster.ts
//
// Generated stubs in ../generated/cluster_controller/ are built from the local
// cluster_controller.proto and include RPCs not yet in globular-web-client@1.2.17.
// The old package is still imported for the unchanged RPCs to avoid churn.
import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import { normalizeError } from '../core/errors'
import * as clusterGrpc    from 'globular-web-client/cluster_controller/cluster_controller_grpc_web_pb'
import * as cc             from 'globular-web-client/cluster_controller/cluster_controller_pb'
import * as planPb         from 'globular-web-client/cluster_controller/plan_pb'

function ccClient(): clusterGrpc.ClusterControllerServiceClient {
  const addr = grpcWebHostUrl()
  return new clusterGrpc.ClusterControllerServiceClient(addr, null, { withCredentials: true })
}

// Generated client — used only for new RPCs not in globular-web-client@1.2.17.
function genClient(): clusterGrpc.ClusterControllerServiceClient {
  const addr = grpcWebHostUrl()
  return new clusterGrpc.ClusterControllerServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NodeCapabilities {
  cpuCount: number
  ramBytes: number
  diskBytes: number
  diskFreeBytes: number
  canApplyPrivileged: boolean
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

export interface NodeHealthV1 {
  nodeId: string
  desiredNetworkHash: string
  appliedNetworkHash: string
  desiredServicesHash: string
  appliedServicesHash: string
  currentPlanId: string
  currentPlanGeneration: number
  currentPlanPhase: string
  lastError: string
  canApplyPrivileged: boolean
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
        cpuCount:           rawCaps.getCpuCount?.()           ?? 0,
        ramBytes:           rawCaps.getRamBytes?.()           ?? 0,
        diskBytes:          rawCaps.getDiskBytes?.()          ?? 0,
        diskFreeBytes:      rawCaps.getDiskFreeBytes?.()      ?? 0,
        canApplyPrivileged: rawCaps.getCanApplyPrivileged?.() ?? false,
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
        cpuCount:           rawCaps.getCpuCount?.()           ?? 0,
        ramBytes:           rawCaps.getRamBytes?.()           ?? 0,
        diskBytes:          rawCaps.getDiskBytes?.()          ?? 0,
        diskFreeBytes:      rawCaps.getDiskFreeBytes?.()      ?? 0,
        canApplyPrivileged: rawCaps.getCanApplyPrivileged?.() ?? false,
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

// ─── Cluster Service Catalog ───────────────────────────────────────────────

export interface ServiceCatalogEntry {
  /** Canonical service name as known to the cluster controller */
  serviceName:    string
  /** Version the controller wants all nodes to run */
  desiredVersion: string
  /** Nodes already at the desired version */
  nodesAtDesired: number
  /** Total nodes that should run this service */
  nodesTotal:     number
  /** Nodes currently mid-upgrade */
  upgrading:      number
}

export interface ClusterHealthV1Result {
  services: ServiceCatalogEntry[]
  nodeHealths: NodeHealthV1[]
}

/**
 * Fetch the cluster-wide desired-service summary via GetClusterHealthV1.
 * Returns null when the cluster controller is unreachable (RPC error).
 * Returns an empty result when the controller is reachable but has no services planned.
 */
export async function getClusterServiceSummary(): Promise<ServiceCatalogEntry[] | null> {
  const result = await getClusterHealthV1Full()
  return result ? result.services : null
}

/**
 * Full GetClusterHealthV1 response including per-node health data.
 * Returns null when the cluster controller is unreachable.
 */
export async function getClusterHealthV1Full(): Promise<ClusterHealthV1Result | null> {
  try {
    const md = metadata()
    const rq = new cc.GetClusterHealthV1Request()
    const rsp = await unary<cc.GetClusterHealthV1Request, cc.GetClusterHealthV1Response>(
      ccClient, 'getClusterHealthV1', rq, undefined, md,
    )
    const services = (rsp.getServicesList?.() ?? []).map((s: any) => ({
      serviceName:    s.getServiceName?.()    ?? '',
      desiredVersion: s.getDesiredVersion?.() ?? '',
      nodesAtDesired: s.getNodesAtDesired?.() ?? 0,
      nodesTotal:     s.getNodesTotal?.()     ?? 0,
      upgrading:      s.getUpgrading?.()      ?? 0,
    }))
    const nodeHealths = (rsp.getNodesList?.() ?? []).map((n: any) => ({
      nodeId:                n.getNodeId?.()                ?? '',
      desiredNetworkHash:    n.getDesiredNetworkHash?.()    ?? '',
      appliedNetworkHash:    n.getAppliedNetworkHash?.()    ?? '',
      desiredServicesHash:   n.getDesiredServicesHash?.()   ?? '',
      appliedServicesHash:   n.getAppliedServicesHash?.()   ?? '',
      currentPlanId:         n.getCurrentPlanId?.()         ?? '',
      currentPlanGeneration: n.getCurrentPlanGeneration?.() ?? 0,
      currentPlanPhase:      n.getCurrentPlanPhase?.()      ?? '',
      lastError:             n.getLastError?.()             ?? '',
      canApplyPrivileged:    n.getCanApplyPrivileged?.()    ?? false,
    } satisfies NodeHealthV1))
    return { services, nodeHealths }
  } catch {
    return null
  }
}

// ─── Desired-state management (typed proto RPCs) ──────────────────────────────
//
// These use the generated ClusterControllerService stubs from
// ../generated/cluster_controller/ which are built from the local proto and
// include RPCs not yet in globular-web-client@1.2.17.

/** A single desired-service entry from the controller plan. */
export interface DesiredEntry {
  serviceId: string
  version:   string
  platform:  string
}

function toDesiredEntry(s: cc.DesiredService): DesiredEntry {
  return { serviceId: s.getServiceId(), version: s.getVersion(), platform: s.getPlatform() }
}

/** Read the current desired-state plan from the controller. */
export async function getDesiredState(): Promise<DesiredEntry[]> {
  const md  = metadata()
  const rq  = new (await import('google-protobuf/google/protobuf/empty_pb.js') as any).Empty()
  const rsp = await unary<any, cc.DesiredState>(genClient, 'getDesiredState', rq, undefined, md)
  return (rsp.getServicesList?.() ?? []).map(toDesiredEntry)
}

/** Upsert a single service into the desired-state plan. */
export async function upsertDesiredService(serviceId: string, version: string): Promise<DesiredEntry[]> {
  const md  = metadata()
  const svc = new cc.DesiredService()
  svc.setServiceId(serviceId)
  svc.setVersion(version)
  const rq  = new cc.UpsertDesiredServiceRequest()
  rq.setService(svc)
  const rsp = await unary<cc.UpsertDesiredServiceRequest, cc.DesiredState>(
    genClient, 'upsertDesiredService', rq, undefined, md,
  )
  return (rsp.getServicesList?.() ?? []).map(toDesiredEntry)
}

/** Remove a service from the desired-state plan. */
export async function removeDesiredService(serviceId: string): Promise<DesiredEntry[]> {
  const md = metadata()
  const rq = new cc.RemoveDesiredServiceRequest()
  rq.setServiceId(serviceId)
  const rsp = await unary<cc.RemoveDesiredServiceRequest, cc.DesiredState>(
    genClient, 'removeDesiredService', rq, undefined, md,
  )
  return (rsp.getServicesList?.() ?? []).map(toDesiredEntry)
}

/** Seed desired state from installed services on the cluster. */
export async function seedDesiredState(
  mode: 'IMPORT_FROM_INSTALLED' | 'DEFAULT_CORE_PROFILE' = 'IMPORT_FROM_INSTALLED',
): Promise<DesiredEntry[]> {
  const md  = metadata()
  const rq  = new cc.SeedDesiredStateRequest()
  rq.setMode(mode === 'IMPORT_FROM_INSTALLED'
    ? cc.SeedDesiredStateRequest.Mode.IMPORT_FROM_INSTALLED
    : cc.SeedDesiredStateRequest.Mode.DEFAULT_CORE_PROFILE)
  const rsp = await unary<cc.SeedDesiredStateRequest, cc.DesiredState>(
    genClient, 'seedDesiredState', rq, undefined, md,
  )
  return (rsp.getServicesList?.() ?? []).map(toDesiredEntry)
}

/** Trigger reconciliation on all known nodes.
 *  Throws an error listing every per-node failure so callers can surface them in the UI.
 */
export async function triggerReconcileAll(nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return
  const md = metadata()
  const results = await Promise.allSettled(
    nodeIds.map(nodeId => {
      const rq = new cc.ReconcileNodeV1Request()
      rq.setNodeId(nodeId)
      return unary<cc.ReconcileNodeV1Request, cc.ReconcileNodeV1Response>(
        ccClient, 'reconcileNodeV1', rq, undefined, md,
      )
    })
  )
  const failures = results
    .map((r, i) => r.status === 'rejected'
      ? `${nodeIds[i]}: ${normalizeError((r as PromiseRejectedResult).reason).message}`
      : null)
    .filter((msg): msg is string => msg !== null)
  if (failures.length > 0) {
    throw new Error(`Reconcile failed on ${failures.length} node(s) — ${failures.join('; ')}`)
  }
}

// ─── Validation + Dry-run ────────────────────────────────────────────────────

export interface ValidationIssue { severity: 'ERROR' | 'WARNING'; message: string }
export interface ValidationReport {
  checksumOk:      boolean
  signatureStatus: string
  platformOk:      boolean
  issues:          ValidationIssue[]
}

export async function validateArtifact(
  serviceId: string,
  version:   string,
  targetNodeIds: string[] = [],
): Promise<ValidationReport> {
  const md = metadata()
  const rq = new cc.ValidateArtifactRequest()
  rq.setServiceId(serviceId)
  rq.setVersion(version)
  rq.setTargetNodeIdsList(targetNodeIds)
  const rsp = await unary<cc.ValidateArtifactRequest, cc.ValidationReport>(
    genClient, 'validateArtifact', rq, undefined, md,
  )
  return {
    checksumOk:      rsp.getChecksumOk(),
    signatureStatus: rsp.getSignatureStatus(),
    platformOk:      rsp.getPlatformOk(),
    issues: (rsp.getIssuesList?.() ?? []).map((i: cc.ValidationIssue) => ({
      severity: i.getSeverity() === cc.ValidationIssue.Severity.ERROR ? 'ERROR' : 'WARNING',
      message:  i.getMessage(),
    })),
  }
}

export interface NodeChange { nodeId: string; willInstall: string[]; willRemove: string[]; warnings: string[] }
export interface PlanPreview { nodeChanges: NodeChange[]; blockingIssues: ValidationIssue[] }

export async function previewDesiredServices(
  upserts:  Array<{ serviceId: string; version: string }>,
  removals: string[],
): Promise<PlanPreview> {
  const md    = metadata()
  const rq    = new cc.DesiredServicesDelta()
  const svcs  = upserts.map(u => {
    const s = new cc.DesiredService(); s.setServiceId(u.serviceId); s.setVersion(u.version); return s
  })
  rq.setUpsertsList(svcs)
  rq.setRemovalsList(removals)
  const rsp = await unary<cc.DesiredServicesDelta, cc.PlanPreview>(
    genClient, 'previewDesiredServices', rq, undefined, md,
  )
  return {
    nodeChanges: (rsp.getNodeChangesList?.() ?? []).map((n: cc.NodeChange) => ({
      nodeId:      n.getNodeId(),
      willInstall: n.getWillInstallList(),
      willRemove:  n.getWillRemoveList(),
      warnings:    n.getWarningsList(),
    })),
    blockingIssues: (rsp.getBlockingIssuesList?.() ?? []).map((i: cc.ValidationIssue) => ({
      severity: i.getSeverity() === cc.ValidationIssue.Severity.ERROR ? 'ERROR' : 'WARNING',
      message:  i.getMessage(),
    })),
  }
}

// Backward-compat shim — the catalog page used this name before the typed RPCs.
/** @deprecated Use upsertDesiredService instead. */
export async function applyServiceDesiredVersion(name: string, version: string): Promise<void> {
  await upsertDesiredService(name, version)
}

/** @deprecated Use seedDesiredState instead. */
export async function seedDesiredStateFromInstalled(
  services: Array<{ name: string; version: string }>,
): Promise<number> {
  const results = await Promise.allSettled(
    services.map(s => upsertDesiredService(s.name, s.version))
  )
  return results.filter(r => r.status === 'fulfilled').length
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
