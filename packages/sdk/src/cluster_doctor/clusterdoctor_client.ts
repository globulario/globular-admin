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

/**
 * Freshness contract published by every report response.
 *
 * cluster-doctor is stateless: every report is computed on-the-fly from
 * a short-TTL (5s default) in-memory snapshot. Callers that need an
 * authoritative read (e.g. right after a remediation, or on user-driven
 * refresh) should pass `{ fresh: true }` to force a new collection.
 *
 * The response always carries this header so the UI can show "snapshot
 * age: 4s, cache hit: yes" and the operator can reason about staleness
 * — see Bug 2 of the 2026-05-10 MinIO incident, where the UI showed
 * CRITICAL findings for minutes after the underlying state cleared
 * because every call read from the cached snapshot without surfacing
 * its age.
 */
export interface ReportHeaderInfo {
  /** "cluster-doctor (leader)" or "cluster-doctor (follower)" */
  source: string
  /** Snapshot identifier — stable across cached re-reads of the same snapshot */
  snapshotId: string
  /** When the snapshot was collected (epoch milliseconds, server clock) */
  observedAtMs: number
  /** How old the snapshot is at response time (server-computed) */
  ageSeconds: number
  /** True when this response was served from cache */
  cacheHit: boolean
  /** Maximum staleness a cached read can have */
  cacheTtlSeconds: number
  /** Mode honoured by the server for this response */
  freshnessMode: cd.FreshnessMode
  /** True when collection touched a subset of upstream sources */
  dataIncomplete: boolean
}

/**
 * Options accepted by every report-fetching SDK function.
 * Defaults to a cached read (server's 5s TTL); pass `fresh: true` to
 * force a fresh collection.
 */
export interface ReportFetchOptions {
  /** Force the server to bypass its snapshot cache. */
  fresh?: boolean
}

export interface ClusterReport {
  overallStatus: cd.ClusterStatus
  findings: Finding[]
  countsByCategory: Record<string, number>
  topIssueIds: string[]
  /** @deprecated read from `header.dataIncomplete` instead */
  dataIncomplete: boolean
  header: ReportHeaderInfo
}

export interface NodeReport {
  nodeId: string
  reachable: boolean
  heartbeatAgeSeconds: number
  findings: Finding[]
  /** @deprecated read from `header.dataIncomplete` instead */
  dataIncomplete: boolean
  header: ReportHeaderInfo
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
  /** @deprecated read from `header.dataIncomplete` instead */
  dataIncomplete: boolean
  header: ReportHeaderInfo
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

function mapHeader(h: any): ReportHeaderInfo {
  // observedAt is a google.protobuf.Timestamp; convert to epoch ms.
  const observedAt = h?.getObservedAt?.()
  const observedAtMs = observedAt
    ? observedAt.getSeconds() * 1000 + Math.floor(observedAt.getNanos() / 1e6)
    : 0
  return {
    source:          h?.getSource?.()              ?? '',
    snapshotId:      h?.getSnapshotId?.()          ?? '',
    observedAtMs,
    ageSeconds:      h?.getSnapshotAgeSeconds?.()  ?? 0,
    cacheHit:        h?.getCacheHit?.()            ?? false,
    cacheTtlSeconds: h?.getCacheTtlSeconds?.()     ?? 0,
    freshnessMode:   h?.getFreshnessMode?.()       ?? cd.FreshnessMode.FRESHNESS_UNSPECIFIED,
    dataIncomplete:  h?.getDataIncomplete?.()      ?? false,
  } satisfies ReportHeaderInfo
}

function applyFreshness(
  rq: { setFreshness: (v: cd.FreshnessMode) => unknown },
  opts?: ReportFetchOptions,
): void {
  if (opts?.fresh) {
    rq.setFreshness(cd.FreshnessMode.FRESHNESS_FRESH)
  }
  // When opts.fresh is false / omitted, leave freshness unset
  // (FRESHNESS_UNSPECIFIED) — server treats that as "honour cache".
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

export async function getClusterReport(opts?: ReportFetchOptions): Promise<ClusterReport> {
  const md = metadata()
  const rq = new cd.ClusterReportRequest()
  applyFreshness(rq, opts)

  const rsp = await unary<cd.ClusterReportRequest, cd.ClusterReport>(
    cdClient, 'getClusterReport', rq, undefined, md,
  )

  const header = mapHeader(rsp.getHeader?.())
  return {
    overallStatus:    rsp.getOverallStatus?.() ?? cd.ClusterStatus.CLUSTER_STATUS_UNKNOWN,
    findings:         (rsp.getFindingsList?.() ?? []).map(mapFinding),
    countsByCategory: mapNumberKV(rsp.getCountsByCategoryMap?.()),
    topIssueIds:      rsp.getTopIssueIdsList?.() ?? [],
    dataIncomplete:   header.dataIncomplete,
    header,
  }
}

export async function getNodeReport(nodeId: string, opts?: ReportFetchOptions): Promise<NodeReport> {
  const md = metadata()
  const rq = new cd.NodeReportRequest()
  rq.setNodeId(nodeId)
  applyFreshness(rq, opts)

  const rsp = await unary<cd.NodeReportRequest, cd.NodeReport>(
    cdClient, 'getNodeReport', rq, undefined, md,
  )

  const header = mapHeader(rsp.getHeader?.())
  return {
    nodeId:              rsp.getNodeId?.()              ?? nodeId,
    reachable:           rsp.getReachable?.()           ?? false,
    heartbeatAgeSeconds: rsp.getHeartbeatAgeSeconds?.() ?? 0,
    findings:            (rsp.getFindingsList?.() ?? []).map(mapFinding),
    dataIncomplete:      header.dataIncomplete,
    header,
  }
}

/**
 * If nodeId is omitted/empty, server may return a cluster-wide drift report
 * (depends on server implementation).
 */
export async function getDriftReport(nodeId?: string, opts?: ReportFetchOptions): Promise<DriftReport> {
  const md = metadata()
  const rq = new cd.DriftReportRequest()
  if (nodeId) rq.setNodeId(nodeId)
  applyFreshness(rq, opts)

  const rsp = await unary<cd.DriftReportRequest, cd.DriftReport>(
    cdClient, 'getDriftReport', rq, undefined, md,
  )

  const header = mapHeader(rsp.getHeader?.())
  return {
    items: (rsp.getItemsList?.() ?? []).map((i: any) => ({
      nodeId:    i.getNodeId?.()    ?? '',
      entityRef: i.getEntityRef?.() ?? '',
      category:  i.getCategory?.()  ?? cd.DriftCategory.DRIFT_UNKNOWN,
      desired:   i.getDesired?.()   ?? '',
      actual:    i.getActual?.()    ?? '',
    } satisfies DriftItem)),
    totalDriftCount: rsp.getTotalDriftCount?.() ?? 0,
    dataIncomplete:  header.dataIncomplete,
    header,
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
