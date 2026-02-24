// packages/backend/src/clusterdoctor/clusterdoctor_client.ts
import { unary } from '../core/rpc'
import { serviceSubdomainUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import { ClusterDoctorServiceClient } from 'clusterdoctor-proto/clusterdoctor_grpc_web_pb'
import * as cd from 'clusterdoctor-proto/clusterdoctor_pb'

export { cd as clusterdoctorpb }

function cdClient(): ClusterDoctorServiceClient {
  const addr = serviceSubdomainUrl('clusterdoctor.ClusterDoctorService')
  return new ClusterDoctorServiceClient(addr, null, { withCredentials: true })
}

// ─── Domain types ────────────────────────────────────────────────────────────

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
  /** Numeric severity from the Severity enum */
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapFinding(f: cd.Finding): Finding {
  return {
    findingId:       f.getFindingId(),
    invariantId:     f.getInvariantId(),
    severity:        f.getSeverity(),
    category:        f.getCategory(),
    entityRef:       f.getEntityRef(),
    summary:         f.getSummary(),
    invariantStatus: f.getInvariantStatus(),
    evidence: f.getEvidenceList().map(e => ({
      sourceService: e.getSourceService(),
      sourceRpc:     e.getSourceRpc(),
      keyValues:     Object.fromEntries(e.getKeyValuesMap().toArray()),
    })),
    remediation: f.getRemediationList().map(r => ({
      order:       r.getOrder(),
      description: r.getDescription(),
      cliCommand:  r.getCliCommand(),
    })),
  }
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function getClusterReport(): Promise<ClusterReport> {
  const md = metadata()
  const rq = new cd.ClusterReportRequest()
  const rsp = await unary<cd.ClusterReportRequest, cd.ClusterReport>(
    cdClient, 'getClusterReport', rq, undefined, md,
  )
  return {
    overallStatus:   rsp.getOverallStatus(),
    findings:        rsp.getFindingsList().map(mapFinding),
    topIssueIds:     rsp.getTopIssueIdsList(),
    dataIncomplete:  rsp.getHeader()?.getDataIncomplete() ?? false,
    countsByCategory: Object.fromEntries(rsp.getCountsByCategoryMap().toArray()),
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
    nodeId:              rsp.getNodeId(),
    reachable:           rsp.getReachable(),
    heartbeatAgeSeconds: rsp.getHeartbeatAgeSeconds(),
    findings:            rsp.getFindingsList().map(mapFinding),
    dataIncomplete:      rsp.getHeader()?.getDataIncomplete() ?? false,
  }
}

export async function getDriftReport(nodeId: string): Promise<DriftReport> {
  const md = metadata()
  const rq = new cd.DriftReportRequest()
  rq.setNodeId(nodeId)
  const rsp = await unary<cd.DriftReportRequest, cd.DriftReport>(
    cdClient, 'getDriftReport', rq, undefined, md,
  )
  return {
    items: rsp.getItemsList().map(i => ({
      nodeId:    i.getNodeId(),
      entityRef: i.getEntityRef(),
      category:  i.getCategory(),
      desired:   i.getDesired(),
      actual:    i.getActual(),
    })),
    totalDriftCount: rsp.getTotalDriftCount(),
    dataIncomplete:  rsp.getHeader()?.getDataIncomplete() ?? false,
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
    findingId:   rsp.getFindingId(),
    invariantId: rsp.getInvariantId(),
    whyFailed:   rsp.getWhyFailed(),
    planRisk:    rsp.getPlanRisk(),
    planDiff:    rsp.getPlanDiffList(),
    remediation: rsp.getRemediationList().map(r => ({
      order:       r.getOrder(),
      description: r.getDescription(),
      cliCommand:  r.getCliCommand(),
    })),
  }
}
