// packages/backend/src/workflow/workflow.ts
//
// Client-side API for the Workflow Trace service.
// Provides functions to fetch workflow runs, steps, and graphs for the admin UI.

import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import * as wfGrpc from 'globular-web-client/workflow/workflow_grpc_web_pb'
import * as wfPb   from 'globular-web-client/workflow/workflow_pb'

function wfClient(): wfGrpc.WorkflowServiceClient {
  return new wfGrpc.WorkflowServiceClient(grpcWebHostUrl(), null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowContext {
  clusterId: string
  nodeId: string
  nodeHostname: string
  componentName: string
  componentKind: number
  componentVersion: string
  releaseKind: string
  releaseObjectId: string
  desiredObjectId: string
  planId: string
  planGeneration: number
}

export interface WorkflowRun {
  id: string
  correlationId: string
  parentRunId: string
  context: WorkflowContext | null
  triggerReason: number
  status: number
  currentActor: number
  failureClass: number
  summary: string
  errorMessage: string
  retryCount: number
  acknowledged: boolean
  acknowledgedBy: string
  startedAt: string
  updatedAt: string
  finishedAt: string
}

export interface WorkflowStep {
  runId: string
  seq: number
  stepKey: string
  title: string
  actor: number
  phase: number
  status: number
  attempt: number
  sourceActor: number
  targetActor: number
  startedAt: string
  finishedAt: string
  durationMs: number
  message: string
  errorCode: string
  errorMessage: string
  retryable: boolean
  operatorActionRequired: boolean
  actionHint: string
  detailsJson: string
}

export interface WorkflowArtifact {
  id: string
  runId: string
  stepSeq: number
  kind: number
  name: string
  version: string
  digest: string
  path: string
}

export interface WorkflowPhaseInfo {
  kind: number
  displayName: string
  stepSeqs: number[]
}

export interface WorkflowActorLane {
  actor: number
  displayName: string
  stepSeqs: number[]
}

export interface WorkflowGraph {
  run: WorkflowRun | null
  phases: WorkflowPhaseInfo[]
  lanes: WorkflowActorLane[]
  artifacts: WorkflowArtifact[]
  currentStepSeq: number
  currentActor: number
  blockedReason: string
}

export interface DiagnoseResult {
  diagnosis: string
  confidence: string
  relatedRunIds: string[]
  suggestedAction: string
}

// ─── Enum display helpers ───────────────────────────────────────────────────

export function runStatusLabel(s: number): string {
  const labels: Record<number, string> = {
    0: 'UNKNOWN', 1: 'PENDING', 2: 'PLANNING', 3: 'WAITING_FOR_SLOT',
    4: 'DISPATCHED', 5: 'EXECUTING', 6: 'BLOCKED', 7: 'RETRYING',
    8: 'SUCCEEDED', 9: 'FAILED', 10: 'CANCELED', 11: 'ROLLED_BACK',
  }
  return labels[s] ?? 'UNKNOWN'
}

export function runStatusColor(s: number): string {
  switch (s) {
    case 8:  return 'var(--success-color)'   // SUCCEEDED
    case 9:  return 'var(--error-color)'     // FAILED
    case 10: return 'var(--secondary-text-color)' // CANCELED
    case 11: return '#f97316'                // ROLLED_BACK
    case 5:  return '#3b82f6'                // EXECUTING
    case 1: case 2: case 3: case 4: return '#f59e0b' // active
    default: return 'var(--secondary-text-color)'
  }
}

export function phaseLabel(p: number): string {
  const labels: Record<number, string> = {
    0: 'Unknown', 1: 'Decision', 2: 'Plan', 3: 'Dispatch',
    4: 'Fetch', 5: 'Install', 6: 'Configure', 7: 'Start',
    8: 'Verify', 9: 'Publish', 10: 'Complete',
  }
  return labels[p] ?? 'Unknown'
}

export function actorLabel(a: number): string {
  const labels: Record<number, string> = {
    0: 'Unknown', 1: 'cluster-controller', 2: 'repository',
    3: 'node-agent', 4: 'installer', 5: 'runtime',
    6: 'operator', 7: 'ai-diagnoser', 8: 'ai-executor',
  }
  return labels[a] ?? 'Unknown'
}

export function stepStatusColor(s: number): string {
  switch (s) {
    case 1: return '#f59e0b'              // RUNNING
    case 2: return 'var(--success-color)' // SUCCEEDED
    case 3: return 'var(--error-color)'   // FAILED
    case 4: return 'var(--secondary-text-color)' // SKIPPED
    case 5: return '#f97316'              // BLOCKED
    default: return 'var(--secondary-text-color)'
  }
}

export function failureClassLabel(f: number): string {
  const labels: Record<number, string> = {
    0: 'UNKNOWN', 1: 'CONFIG', 2: 'PACKAGE', 3: 'DEPENDENCY',
    4: 'NETWORK', 5: 'REPOSITORY', 6: 'SYSTEMD', 7: 'VALIDATION',
  }
  return labels[f] ?? 'UNKNOWN'
}

export function triggerReasonLabel(t: number): string {
  const labels: Record<number, string> = {
    0: 'UNKNOWN', 1: 'DESIRED_DRIFT', 2: 'BOOTSTRAP', 3: 'RETRY',
    4: 'MANUAL', 5: 'DEPENDENCY_UNBLOCKED', 6: 'UPGRADE', 7: 'REPAIR',
  }
  return labels[t] ?? 'UNKNOWN'
}

export function triggerReasonColor(t: number): string {
  switch (t) {
    case 2: return '#8b5cf6'   // BOOTSTRAP — purple
    case 7: return '#f59e0b'   // REPAIR — amber
    case 1: return '#3b82f6'   // DESIRED_DRIFT — blue
    case 6: return '#10b981'   // UPGRADE — green
    case 3: return '#f97316'   // RETRY — orange
    case 4: return 'var(--secondary-text-color)' // MANUAL
    default: return 'var(--secondary-text-color)'
  }
}

// ─── API functions ──────────────────────────────────────────────────────────

function pbToContext(ctx: any): WorkflowContext | null {
  if (!ctx) return null
  return {
    clusterId: ctx.getClusterId?.() ?? '',
    nodeId: ctx.getNodeId?.() ?? '',
    nodeHostname: ctx.getNodeHostname?.() ?? '',
    componentName: ctx.getComponentName?.() ?? '',
    componentKind: ctx.getComponentKind?.() ?? 0,
    componentVersion: ctx.getComponentVersion?.() ?? '',
    releaseKind: ctx.getReleaseKind?.() ?? '',
    releaseObjectId: ctx.getReleaseObjectId?.() ?? '',
    desiredObjectId: ctx.getDesiredObjectId?.() ?? '',
    planId: ctx.getPlanId?.() ?? '',
    planGeneration: ctx.getPlanGeneration?.() ?? 0,
  }
}

function pbToRun(r: any): WorkflowRun {
  return {
    id: r.getId?.() ?? '',
    correlationId: r.getCorrelationId?.() ?? '',
    parentRunId: r.getParentRunId?.() ?? '',
    context: pbToContext(r.getContext?.()),
    triggerReason: r.getTriggerReason?.() ?? 0,
    status: r.getStatus?.() ?? 0,
    currentActor: r.getCurrentActor?.() ?? 0,
    failureClass: r.getFailureClass?.() ?? 0,
    summary: r.getSummary?.() ?? '',
    errorMessage: r.getErrorMessage?.() ?? '',
    retryCount: r.getRetryCount?.() ?? 0,
    acknowledged: r.getAcknowledged?.() ?? false,
    acknowledgedBy: r.getAcknowledgedBy?.() ?? '',
    startedAt: r.getStartedAt?.()?.toDate?.()?.toISOString?.() ?? '',
    updatedAt: r.getUpdatedAt?.()?.toDate?.()?.toISOString?.() ?? '',
    finishedAt: r.getFinishedAt?.()?.toDate?.()?.toISOString?.() ?? '',
  }
}

function pbToStep(s: any): WorkflowStep {
  return {
    runId: s.getRunId?.() ?? '',
    seq: s.getSeq?.() ?? 0,
    stepKey: s.getStepKey?.() ?? '',
    title: s.getTitle?.() ?? '',
    actor: s.getActor?.() ?? 0,
    phase: s.getPhase?.() ?? 0,
    status: s.getStatus?.() ?? 0,
    attempt: s.getAttempt?.() ?? 0,
    sourceActor: s.getSourceActor?.() ?? 0,
    targetActor: s.getTargetActor?.() ?? 0,
    startedAt: s.getStartedAt?.()?.toDate?.()?.toISOString?.() ?? '',
    finishedAt: s.getFinishedAt?.()?.toDate?.()?.toISOString?.() ?? '',
    durationMs: s.getDurationMs?.() ?? 0,
    message: s.getMessage?.() ?? '',
    errorCode: s.getErrorCode?.() ?? '',
    errorMessage: s.getErrorMessage?.() ?? '',
    retryable: s.getRetryable?.() ?? false,
    operatorActionRequired: s.getOperatorActionRequired?.() ?? false,
    actionHint: s.getActionHint?.() ?? '',
    detailsJson: s.getDetailsJson?.() ?? '',
  }
}

/** List workflow runs for a component (service) on a specific node. */
export async function listWorkflowRuns(
  clusterId: string,
  opts: { nodeId?: string; componentName?: string; activeOnly?: boolean; failedOnly?: boolean; limit?: number } = {}
): Promise<WorkflowRun[]> {
  const req = new wfPb.ListRunsRequest()
  req.setClusterId(clusterId)
  if (opts.nodeId) req.setNodeId(opts.nodeId)
  if (opts.componentName) req.setComponentName(opts.componentName)
  if (opts.activeOnly) req.setActiveOnly(true)
  if (opts.failedOnly) req.setFailedOnly(true)
  req.setLimit(opts.limit ?? 20)

  const resp = await unary<wfPb.ListRunsRequest, wfPb.ListRunsResponse>(
    wfClient, 'listRuns', req, 'workflow.WorkflowService'
  )
  return (resp.getRunsList?.() ?? []).map(pbToRun)
}

/** Get a single workflow run with steps and artifacts. */
export async function getWorkflowRun(clusterId: string, runId: string): Promise<{ run: WorkflowRun; steps: WorkflowStep[]; artifacts: WorkflowArtifact[] }> {
  const req = new wfPb.GetRunRequest()
  req.setClusterId(clusterId)
  req.setId(runId)

  const resp = await unary<wfPb.GetRunRequest, wfPb.WorkflowRunDetail>(
    wfClient, 'getRun', req, 'workflow.WorkflowService'
  )

  const run = pbToRun(resp.getRun?.())
  const steps = (resp.getStepsList?.() ?? []).map(pbToStep)
  const artifacts = (resp.getArtifactsList?.() ?? []).map((a: any) => ({
    id: a.getId?.() ?? '',
    runId: a.getRunId?.() ?? '',
    stepSeq: a.getStepSeq?.() ?? 0,
    kind: a.getKind?.() ?? 0,
    name: a.getName?.() ?? '',
    version: a.getVersion?.() ?? '',
    digest: a.getDigest?.() ?? '',
    path: a.getPath?.() ?? '',
  }))

  return { run, steps, artifacts }
}

/** Get the workflow graph for a run (phases + actor lanes for swimlane rendering). */
export async function getWorkflowGraph(clusterId: string, runId: string): Promise<WorkflowGraph> {
  const req = new wfPb.GetWorkflowGraphRequest()
  req.setClusterId(clusterId)
  req.setRunId(runId)

  const resp = await unary<wfPb.GetWorkflowGraphRequest, wfPb.WorkflowGraph>(
    wfClient, 'getWorkflowGraph', req, 'workflow.WorkflowService'
  )

  return {
    run: resp.getRun?.() ? pbToRun(resp.getRun()) : null,
    phases: (resp.getPhasesList?.() ?? []).map((p: any) => ({
      kind: p.getKind?.() ?? 0,
      displayName: p.getDisplayName?.() ?? '',
      stepSeqs: p.getStepSeqsList?.() ?? [],
    })),
    lanes: (resp.getLanesList?.() ?? []).map((l: any) => ({
      actor: l.getActor?.() ?? 0,
      displayName: l.getDisplayName?.() ?? '',
      stepSeqs: l.getStepSeqsList?.() ?? [],
    })),
    artifacts: (resp.getArtifactsList?.() ?? []).map((a: any) => ({
      id: a.getId?.() ?? '',
      runId: a.getRunId?.() ?? '',
      stepSeq: a.getStepSeq?.() ?? 0,
      kind: a.getKind?.() ?? 0,
      name: a.getName?.() ?? '',
      version: a.getVersion?.() ?? '',
      digest: a.getDigest?.() ?? '',
      path: a.getPath?.() ?? '',
    })),
    currentStepSeq: resp.getCurrentStepSeq?.() ?? 0,
    currentActor: resp.getCurrentActor?.() ?? 0,
    blockedReason: resp.getBlockedReason?.() ?? '',
  }
}

/** Diagnose a failed run. */
export async function diagnoseWorkflowRun(clusterId: string, runId: string): Promise<DiagnoseResult> {
  const req = new wfPb.DiagnoseRunRequest()
  req.setClusterId(clusterId)
  req.setRunId(runId)

  const resp = await unary<wfPb.DiagnoseRunRequest, wfPb.DiagnoseRunResponse>(
    wfClient, 'diagnoseRun', req, 'workflow.WorkflowService'
  )

  return {
    diagnosis: resp.getDiagnosis?.() ?? '',
    confidence: resp.getConfidence?.() ?? '',
    relatedRunIds: resp.getRelatedRunIdsList?.() ?? [],
    suggestedAction: resp.getSuggestedAction?.() ?? '',
  }
}

/** Retry a failed run (creates a new run linked to the original). */
export async function retryWorkflowRun(clusterId: string, runId: string): Promise<WorkflowRun> {
  const req = new wfPb.RetryRunRequest()
  req.setClusterId(clusterId)
  req.setRunId(runId)

  const resp = await unary<wfPb.RetryRunRequest, wfPb.WorkflowRun>(
    wfClient, 'retryRun', req, 'workflow.WorkflowService'
  )
  return pbToRun(resp)
}

/** Acknowledge a run (operator saw it). */
export async function acknowledgeWorkflowRun(clusterId: string, runId: string, acknowledgedBy: string): Promise<void> {
  const req = new wfPb.AcknowledgeRunRequest()
  req.setClusterId(clusterId)
  req.setRunId(runId)
  req.setAcknowledgedBy(acknowledgedBy)

  await unary<wfPb.AcknowledgeRunRequest, any>(
    wfClient, 'acknowledgeRun', req, 'workflow.WorkflowService'
  )
}

/** Get the latest workflow run for a component on a node. */
export async function getLatestRunForComponent(
  clusterId: string, componentName: string, nodeId?: string
): Promise<WorkflowRun | null> {
  const runs = await listWorkflowRuns(clusterId, { componentName, nodeId, limit: 1 })
  return runs.length > 0 ? runs[0] : null
}
