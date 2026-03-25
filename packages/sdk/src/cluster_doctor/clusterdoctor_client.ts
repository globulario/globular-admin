// packages/backend/src/cluster_doctor/clusterdoctor_client.ts
import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as cdGrpc from 'globular-web-client/cluster_doctor/cluster_doctor_grpc_web_pb'
import * as cd from 'globular-web-client/cluster_doctor/cluster_doctor_pb'

export { cd as clusterdoctorpb }

function cdClient(): cdGrpc.ClusterDoctorServiceClient {
  const addr = grpcWebHostUrl()
  return new cdGrpc.ClusterDoctorServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RemediationStep {
  order: number
  description: string
  cliCommand: string
}

export interface EvidenceItem {
  sourceService: string
  sourceRpc: string
  keyValues: Record<string, string>
}

export interface Finding {
  findingId: string
  invariantId: string
  /** Numeric enum value from clusterdoctorpb.Severity */
  severity: cd.Severity
  category: string
  entityRef: string
  summary: string
  evidence: EvidenceItem[]
  remediation: RemediationStep[]
  invariantStatus: cd.InvariantStatus
}

export interface ClusterReport {
  overallStatus: cd.ClusterStatus
  findings: Finding[]
  countsByCategory: Record<string, number>
  topIssueIds: string[]
  dataIncomplete: boolean
}

export interface NodeReport {
  nodeId: string
  reachable: boolean
  heartbeatAgeSeconds: number
  findings: Finding[]
  dataIncomplete: boolean
}

export interface DriftItem {
  nodeId: string
  entityRef: string
  category: cd.DriftCategory
  desired: string
  actual: string
}

export interface DriftReport {
  items: DriftItem[]
  totalDriftCount: number
  dataIncomplete: boolean
}

export interface FindingExplanation {
  findingId: string
  invariantId: string
  whyFailed: string
  remediation: RemediationStep[]
  planRisk: cd.PlanRisk
  planDiff: string[]
  evidence: EvidenceItem[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapKV(map: any): Record<string, string> {
  try { return Object.fromEntries(map?.toArray?.() ?? []) } catch { return {} }
}

function mapNumberKV(map: any): Record<string, number> {
  try {
    return Object.fromEntries(
      (map?.toArray?.() ?? []).map(
        ([k, v]: [string, any]) => [k, Number(v) || 0]
      )
    )
  } catch {
    return {}
  }
}

function mapRemediationStep(r: any): RemediationStep {
  return {
    order:       r.getOrder?.()       ?? 0,
    description: r.getDescription?.() ?? '',
    cliCommand:  r.getCliCommand?.()  ?? '',
  } satisfies RemediationStep
}

function mapEvidence(e: any): EvidenceItem {
  return {
    sourceService: e.getSourceService?.() ?? '',
    sourceRpc:     e.getSourceRpc?.()     ?? '',
    keyValues:     mapKV(e.getKeyValuesMap?.()),
  } satisfies EvidenceItem
}

function mapFinding(f: any): Finding {
  return {
    findingId:       f.getFindingId?.()       ?? '',
    invariantId:     f.getInvariantId?.()     ?? '',
    severity:        f.getSeverity?.()        ?? cd.Severity.SEVERITY_UNKNOWN,
    category:        f.getCategory?.()        ?? '',
    entityRef:       f.getEntityRef?.()       ?? '',
    summary:         f.getSummary?.()         ?? '',
    invariantStatus: f.getInvariantStatus?.() ?? cd.InvariantStatus.INVARIANT_UNKNOWN,
    evidence:        (f.getEvidenceList?.() ?? []).map(mapEvidence),
    remediation:     (f.getRemediationList?.() ?? []).map(mapRemediationStep),
  } satisfies Finding
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function getClusterReport(): Promise<ClusterReport> {
  const md = metadata()
  const rq = new cd.ClusterReportRequest()

  const rsp = await unary<cd.ClusterReportRequest, cd.ClusterReport>(
    cdClient, 'getClusterReport', rq, undefined, md,
  )

  return {
    overallStatus:    rsp.getOverallStatus?.() ?? cd.ClusterStatus.CLUSTER_STATUS_UNKNOWN,
    findings:         (rsp.getFindingsList?.() ?? []).map(mapFinding),
    countsByCategory: mapNumberKV(rsp.getCountsByCategoryMap?.()),
    topIssueIds:      rsp.getTopIssueIdsList?.() ?? [],
    dataIncomplete:   rsp.getHeader?.()?.getDataIncomplete?.() ?? false,
  }
}

export async function getNodeReport(nodeId: string): Promise<NodeReport> {
  const md = metadata()
  const rq = new cd.NodeReportRequest()
  rq.setNodeId(nodeId)

  const rsp = await unary<cd.NodeReportRequest, cd.NodeReport>(
    cdClient, 'getNodeReport', rq, undefined, md,
  )

  return {
    nodeId:              rsp.getNodeId?.()              ?? nodeId,
    reachable:           rsp.getReachable?.()           ?? false,
    heartbeatAgeSeconds: rsp.getHeartbeatAgeSeconds?.() ?? 0,
    findings:            (rsp.getFindingsList?.() ?? []).map(mapFinding),
    dataIncomplete:      rsp.getHeader?.()?.getDataIncomplete?.() ?? false,
  }
}

/**
 * If nodeId is omitted/empty, server may return a cluster-wide drift report
 * (depends on server implementation).
 */
export async function getDriftReport(nodeId?: string): Promise<DriftReport> {
  const md = metadata()
  const rq = new cd.DriftReportRequest()
  if (nodeId) rq.setNodeId(nodeId)

  const rsp = await unary<cd.DriftReportRequest, cd.DriftReport>(
    cdClient, 'getDriftReport', rq, undefined, md,
  )

  return {
    items: (rsp.getItemsList?.() ?? []).map((i: any) => ({
      nodeId:    i.getNodeId?.()    ?? '',
      entityRef: i.getEntityRef?.() ?? '',
      category:  i.getCategory?.()  ?? cd.DriftCategory.DRIFT_UNKNOWN,
      desired:   i.getDesired?.()   ?? '',
      actual:    i.getActual?.()    ?? '',
    } satisfies DriftItem)),
    totalDriftCount: rsp.getTotalDriftCount?.() ?? 0,
    dataIncomplete:  rsp.getHeader?.()?.getDataIncomplete?.() ?? false,
  }
}

export async function explainFinding(findingId: string): Promise<FindingExplanation> {
  const md = metadata()
  const rq = new cd.ExplainFindingRequest()
  rq.setFindingId(findingId)

  const rsp = await unary<cd.ExplainFindingRequest, cd.FindingExplanation>(
    cdClient, 'explainFinding', rq, undefined, md,
  )

  return {
    findingId:   rsp.getFindingId?.()   ?? findingId,
    invariantId: rsp.getInvariantId?.() ?? '',
    whyFailed:   rsp.getWhyFailed?.()   ?? '',
    planRisk:    rsp.getPlanRisk?.()    ?? cd.PlanRisk.PLAN_RISK_UNKNOWN,
    planDiff:    rsp.getPlanDiffList?.() ?? [],
    remediation: (rsp.getRemediationList?.() ?? []).map(mapRemediationStep),
    evidence:    (rsp.getEvidenceList?.() ?? []).map(mapEvidence),
  }
}
