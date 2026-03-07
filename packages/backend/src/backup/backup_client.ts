// packages/backend/src/backup/backup_client.ts
import { unary } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as bmGrpc from 'globular-web-client/backup_manager/backup_manager_grpc_web_pb'
import * as bm from 'globular-web-client/backup_manager/backup_manager_pb'

export { bm as backuppb }

function bmClient(): bmGrpc.BackupManagerServiceClient {
  const addr = grpcWebHostUrl()
  return new bmGrpc.BackupManagerServiceClient(addr, null, { withCredentials: true })
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProviderResult {
  type: number
  enabled: boolean
  state: number
  severity: number
  summary: string
  outputs: Record<string, string>
  errorMessage: string
  startedMs: number
  finishedMs: number
  bytesWritten: number
  payloadFiles: string[]
  outputFiles: string[]
}

export interface ReplicationResult {
  destinationName: string
  destinationType: number
  destinationPath: string
  state: number
  errorMessage: string
  bytesWritten: number
  startedMs: number
  finishedMs: number
}

export interface BackupJob {
  jobId: string
  planName: string
  state: number
  createdMs: number
  startedMs: number
  finishedMs: number
  results: ProviderResult[]
  backupId: string
  message: string
  replications: ReplicationResult[]
  jobType: number
}

export interface SkippedProvider {
  name: string
  reason: string
}

export interface HookResultItem {
  serviceName: string
  ok: boolean
  message: string
  durationMs: number
}

export interface BackupArtifact {
  backupId: string
  createdMs: number
  location: string
  planName: string
  clusterId: string
  domain: string
  createdBy: string
  providerResults: ProviderResult[]
  manifestSha256: string
  totalBytes: number
  locations: string[]
  replications: ReplicationResult[]
  schemaVersion: number
  mode: number
  labels: Record<string, string>
  qualityState: number
  clusterInfo: { clusterId: string; domain: string; nodeId: string } | null
  hooks: { prepare: HookResultItem[]; finalize: HookResultItem[] } | null
  skippedProviders: SkippedProvider[]
}

export interface BackupValidationIssue {
  severity: number
  code: string
  message: string
}

export interface RestoreStep {
  order: number
  title: string
  details: string
}

export interface ToolCheckResult {
  name: string
  available: boolean
  version: string
  path: string
  errorMessage: string
}

export interface RetentionStatus {
  keepLastN: number
  keepDays: number
  maxTotalBytes: number
  currentBackupCount: number
  currentTotalBytes: number
  oldestMs: number
  newestMs: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapKV(map: any): Record<string, string> {
  try { return Object.fromEntries(map?.toArray?.() ?? []) } catch { return {} }
}

function mapProviderResult(r: any): ProviderResult {
  return {
    type:         r.getType?.()           ?? 0,
    enabled:      r.getEnabled?.()        ?? false,
    state:        r.getState?.()          ?? 0,
    severity:     r.getSeverity?.()       ?? 0,
    summary:      r.getSummary?.()        ?? '',
    outputs:      mapKV(r.getOutputsMap?.()),
    errorMessage: r.getErrorMessage?.()   ?? '',
    startedMs:    r.getStartedUnixMs?.()  ?? 0,
    finishedMs:   r.getFinishedUnixMs?.() ?? 0,
    bytesWritten: r.getBytesWritten?.()   ?? 0,
    payloadFiles: r.getPayloadFilesList?.() ?? [],
    outputFiles:  r.getOutputFilesList?.() ?? [],
  }
}

function mapReplication(r: any): ReplicationResult {
  return {
    destinationName: r.getDestinationName?.() ?? '',
    destinationType: r.getDestinationType?.() ?? 0,
    destinationPath: r.getDestinationPath?.() ?? '',
    state:           r.getState?.()           ?? 0,
    errorMessage:    r.getErrorMessage?.()    ?? '',
    bytesWritten:    r.getBytesWritten?.()    ?? 0,
    startedMs:       r.getStartedUnixMs?.()  ?? 0,
    finishedMs:      r.getFinishedUnixMs?.() ?? 0,
  }
}

function mapJob(j: any): BackupJob {
  return {
    jobId:        j.getJobId?.()          ?? '',
    planName:     j.getPlanName?.()       ?? '',
    state:        j.getState?.()          ?? 0,
    createdMs:    j.getCreatedUnixMs?.()  ?? 0,
    startedMs:    j.getStartedUnixMs?.()  ?? 0,
    finishedMs:   j.getFinishedUnixMs?.() ?? 0,
    results:      (j.getResultsList?.() ?? []).map(mapProviderResult),
    backupId:     j.getBackupId?.()       ?? '',
    message:      j.getMessage?.()        ?? '',
    replications: (j.getReplicationsList?.() ?? []).map(mapReplication),
    jobType:      j.getJobType?.()        ?? 0,
  }
}

function mapHookResult(h: any): HookResultItem {
  return {
    serviceName: h.getServiceName?.() ?? '',
    ok:          h.getOk?.()          ?? false,
    message:     h.getMessage?.()     ?? '',
    durationMs:  h.getDurationMs?.()  ?? 0,
  }
}

function mapArtifact(a: any): BackupArtifact {
  const cluster = a.getCluster?.()
  const hooks = a.getHooks?.()
  return {
    backupId:        a.getBackupId?.()         ?? '',
    createdMs:       a.getCreatedUnixMs?.()    ?? 0,
    location:        a.getLocation?.()         ?? '',
    planName:        a.getPlanName?.()         ?? '',
    clusterId:       a.getClusterId?.()        ?? '',
    domain:          a.getDomain?.()           ?? '',
    createdBy:       a.getCreatedBy?.()        ?? '',
    providerResults: (a.getProviderResultsList?.() ?? []).map(mapProviderResult),
    manifestSha256:  a.getManifestSha256?.()   ?? '',
    totalBytes:      a.getTotalBytes?.()       ?? 0,
    locations:       a.getLocationsList?.()    ?? [],
    replications:    (a.getReplicationsList?.() ?? []).map(mapReplication),
    schemaVersion:   a.getSchemaVersion?.()    ?? 0,
    mode:            a.getMode?.()             ?? 0,
    labels:          mapKV(a.getLabelsMap?.()),
    qualityState:    a.getQualityState?.()     ?? 0,
    clusterInfo:     cluster ? {
      clusterId: cluster.getClusterId?.() ?? '',
      domain:    cluster.getDomain?.()    ?? '',
      nodeId:    cluster.getNodeId?.()    ?? '',
    } : null,
    hooks: hooks ? {
      prepare:  (hooks.getPrepareList?.()  ?? []).map(mapHookResult),
      finalize: (hooks.getFinalizeList?.() ?? []).map(mapHookResult),
    } : null,
    skippedProviders: (a.getSkippedProvidersList?.() ?? []).map((s: any) => ({
      name:   s.getName?.()   ?? '',
      reason: s.getReason?.() ?? '',
    })),
  }
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function runBackup(opts: {
  mode?: number
  planName?: string
  labels?: Record<string, string>
}): Promise<string> {
  const md = metadata()
  const rq = new bm.RunBackupRequest()
  if (opts.mode) rq.setMode(opts.mode)
  if (opts.planName) {
    const plan = new bm.BackupPlan()
    plan.setName(opts.planName)
    rq.setPlan(plan)
  }
  if (opts.labels) {
    const map = rq.getLabelsMap()
    for (const [k, v] of Object.entries(opts.labels)) map.set(k, v)
  }

  const rsp = await unary<bm.RunBackupRequest, bm.RunBackupResponse>(
    bmClient, 'runBackup', rq, undefined, md,
  )
  return rsp.getJobId?.() ?? ''
}

export async function getBackupJob(jobId: string): Promise<BackupJob> {
  const md = metadata()
  const rq = new bm.GetBackupJobRequest()
  rq.setJobId(jobId)

  const rsp = await unary<bm.GetBackupJobRequest, bm.GetBackupJobResponse>(
    bmClient, 'getBackupJob', rq, undefined, md,
  )
  return mapJob(rsp.getJob?.())
}

export async function listBackupJobs(opts?: {
  limit?: number; offset?: number; state?: number; planName?: string
}): Promise<{ jobs: BackupJob[]; total: number }> {
  const md = metadata()
  const rq = new bm.ListBackupJobsRequest()
  if (opts?.limit) rq.setLimit(opts.limit)
  if (opts?.offset) rq.setOffset(opts.offset)
  if (opts?.state) rq.setState(opts.state)
  if (opts?.planName) rq.setPlanName(opts.planName)

  const rsp = await unary<bm.ListBackupJobsRequest, bm.ListBackupJobsResponse>(
    bmClient, 'listBackupJobs', rq, undefined, md,
  )
  return {
    jobs: (rsp.getJobsList?.() ?? []).map(mapJob),
    total: rsp.getTotal?.() ?? 0,
  }
}

export async function listBackups(opts?: {
  limit?: number; offset?: number; planName?: string; mode?: number; qualityState?: number
}): Promise<{ backups: BackupArtifact[]; total: number }> {
  const md = metadata()
  const rq = new bm.ListBackupsRequest()
  if (opts?.limit) rq.setLimit(opts.limit)
  if (opts?.offset) rq.setOffset(opts.offset)
  if (opts?.planName) rq.setPlanName(opts.planName)
  if (opts?.mode) rq.setMode(opts.mode)
  if (opts?.qualityState) rq.setQualityState(opts.qualityState)

  const rsp = await unary<bm.ListBackupsRequest, bm.ListBackupsResponse>(
    bmClient, 'listBackups', rq, undefined, md,
  )
  return {
    backups: (rsp.getBackupsList?.() ?? []).map(mapArtifact),
    total: rsp.getTotal?.() ?? 0,
  }
}

export async function getBackup(backupId: string): Promise<BackupArtifact> {
  const md = metadata()
  const rq = new bm.GetBackupRequest()
  rq.setBackupId(backupId)

  const rsp = await unary<bm.GetBackupRequest, bm.GetBackupResponse>(
    bmClient, 'getBackup', rq, undefined, md,
  )
  return mapArtifact(rsp.getBackup?.())
}

export async function deleteBackup(backupId: string, deleteArtifacts = true): Promise<{
  deleted: boolean; message: string
}> {
  const md = metadata()
  const rq = new bm.DeleteBackupRequest()
  rq.setBackupId(backupId)
  rq.setDeleteProviderArtifacts(deleteArtifacts)

  const rsp = await unary<bm.DeleteBackupRequest, bm.DeleteBackupResponse>(
    bmClient, 'deleteBackup', rq, undefined, md,
  )
  return {
    deleted: rsp.getDeleted?.() ?? false,
    message: rsp.getMessage?.() ?? '',
  }
}

export async function deleteBackupJob(jobId: string, deleteArtifacts = false): Promise<{
  deleted: boolean; message: string
}> {
  const md = metadata()
  const rq = new bm.DeleteBackupJobRequest()
  rq.setJobId(jobId)
  rq.setDeleteArtifacts(deleteArtifacts)

  const rsp = await unary<bm.DeleteBackupJobRequest, bm.DeleteBackupJobResponse>(
    bmClient, 'deleteBackupJob', rq, undefined, md,
  )
  return {
    deleted: rsp.getDeleted?.() ?? false,
    message: rsp.getMessage?.() ?? '',
  }
}

export async function validateBackup(backupId: string, deep = false): Promise<{
  valid: boolean; issues: BackupValidationIssue[]
}> {
  const md = metadata()
  const rq = new bm.ValidateBackupRequest()
  rq.setBackupId(backupId)
  rq.setDeep(deep)

  const rsp = await unary<bm.ValidateBackupRequest, bm.ValidateBackupResponse>(
    bmClient, 'validateBackup', rq, undefined, md,
  )
  return {
    valid: rsp.getValid?.() ?? false,
    issues: (rsp.getIssuesList?.() ?? []).map((i: any) => ({
      severity: i.getSeverity?.() ?? 0,
      code:     i.getCode?.()     ?? '',
      message:  i.getMessage?.()  ?? '',
    })),
  }
}

export async function restorePlan(backupId: string, opts: {
  includeEtcd?: boolean; includeConfig?: boolean; includeMinio?: boolean; includeScylla?: boolean
}): Promise<{
  backupId: string; steps: RestoreStep[]; warnings: BackupValidationIssue[]; confirmationToken: string
}> {
  const md = metadata()
  const rq = new bm.RestorePlanRequest()
  rq.setBackupId(backupId)
  if (opts.includeEtcd) rq.setIncludeEtcd(true)
  if (opts.includeConfig) rq.setIncludeConfig(true)
  if (opts.includeMinio) rq.setIncludeMinio(true)
  if (opts.includeScylla) rq.setIncludeScylla(true)

  const rsp = await unary<bm.RestorePlanRequest, bm.RestorePlanResponse>(
    bmClient, 'restorePlan', rq, undefined, md,
  )
  return {
    backupId: rsp.getBackupId?.() ?? backupId,
    steps: (rsp.getStepsList?.() ?? []).map((s: any) => ({
      order:   s.getOrder?.()   ?? 0,
      title:   s.getTitle?.()   ?? '',
      details: s.getDetails?.() ?? '',
    })),
    warnings: (rsp.getWarningsList?.() ?? []).map((w: any) => ({
      severity: w.getSeverity?.() ?? 0,
      code:     w.getCode?.()     ?? '',
      message:  w.getMessage?.()  ?? '',
    })),
    confirmationToken: rsp.getConfirmationToken?.() ?? '',
  }
}

export async function restoreBackup(backupId: string, opts: {
  includeEtcd?: boolean; includeConfig?: boolean; includeMinio?: boolean; includeScylla?: boolean
  dryRun?: boolean; force?: boolean; confirmationToken?: string
}): Promise<{
  jobId: string; dryRun: boolean; steps: RestoreStep[]; warnings: BackupValidationIssue[]
}> {
  const md = metadata()
  const rq = new bm.RestoreBackupRequest()
  rq.setBackupId(backupId)
  if (opts.includeEtcd) rq.setIncludeEtcd(true)
  if (opts.includeConfig) rq.setIncludeConfig(true)
  if (opts.includeMinio) rq.setIncludeMinio(true)
  if (opts.includeScylla) rq.setIncludeScylla(true)
  if (opts.dryRun) rq.setDryRun(true)
  if (opts.force) rq.setForce(true)
  if (opts.confirmationToken) rq.setConfirmationToken(opts.confirmationToken)

  const rsp = await unary<bm.RestoreBackupRequest, bm.RestoreBackupResponse>(
    bmClient, 'restoreBackup', rq, undefined, md,
  )
  return {
    jobId: rsp.getJobId?.() ?? '',
    dryRun: rsp.getDryRun?.() ?? false,
    steps: (rsp.getStepsList?.() ?? []).map((s: any) => ({
      order:   s.getOrder?.()   ?? 0,
      title:   s.getTitle?.()   ?? '',
      details: s.getDetails?.() ?? '',
    })),
    warnings: (rsp.getWarningsList?.() ?? []).map((w: any) => ({
      severity: w.getSeverity?.() ?? 0,
      code:     w.getCode?.()     ?? '',
      message:  w.getMessage?.()  ?? '',
    })),
  }
}

export async function cancelBackupJob(jobId: string): Promise<{ canceled: boolean; message: string }> {
  const md = metadata()
  const rq = new bm.CancelBackupJobRequest()
  rq.setJobId(jobId)

  const rsp = await unary<bm.CancelBackupJobRequest, bm.CancelBackupJobResponse>(
    bmClient, 'cancelBackupJob', rq, undefined, md,
  )
  return {
    canceled: rsp.getCanceled?.() ?? false,
    message:  rsp.getMessage?.()  ?? '',
  }
}

export async function preflightCheck(): Promise<{ tools: ToolCheckResult[]; allOk: boolean }> {
  const md = metadata()
  const rq = new bm.PreflightCheckRequest()

  const rsp = await unary<bm.PreflightCheckRequest, bm.PreflightCheckResponse>(
    bmClient, 'preflightCheck', rq, undefined, md,
  )
  return {
    tools: (rsp.getToolsList?.() ?? []).map((t: any) => ({
      name:         t.getName?.()         ?? '',
      available:    t.getAvailable?.()    ?? false,
      version:      t.getVersion?.()      ?? '',
      path:         t.getPath?.()         ?? '',
      errorMessage: t.getErrorMessage?.() ?? '',
    })),
    allOk: rsp.getAllOk?.() ?? false,
  }
}

export async function runRetention(dryRun = false): Promise<{
  deletedIds: string[]; keptIds: string[]; dryRun: boolean; message: string
}> {
  const md = metadata()
  const rq = new bm.RunRetentionRequest()
  rq.setDryRun(dryRun)

  const rsp = await unary<bm.RunRetentionRequest, bm.RunRetentionResponse>(
    bmClient, 'runRetention', rq, undefined, md,
  )
  return {
    deletedIds: rsp.getDeletedBackupIdsList?.() ?? [],
    keptIds:    rsp.getKeptBackupIdsList?.()    ?? [],
    dryRun:     rsp.getDryRun?.()               ?? false,
    message:    rsp.getMessage?.()              ?? '',
  }
}

export async function getRetentionStatus(): Promise<RetentionStatus> {
  const md = metadata()
  const rq = new bm.GetRetentionStatusRequest()

  const rsp = await unary<bm.GetRetentionStatusRequest, bm.GetRetentionStatusResponse>(
    bmClient, 'getRetentionStatus', rq, undefined, md,
  )
  const pol = rsp.getPolicy?.()
  return {
    keepLastN:          pol?.getKeepLastN?.()      ?? 0,
    keepDays:           pol?.getKeepDays?.()       ?? 0,
    maxTotalBytes:      pol?.getMaxTotalBytes?.()  ?? 0,
    currentBackupCount: rsp.getCurrentBackupCount?.() ?? 0,
    currentTotalBytes:  rsp.getCurrentTotalBytes?.()  ?? 0,
    oldestMs:           rsp.getOldestBackupUnixMs?.() ?? 0,
    newestMs:           rsp.getNewestBackupUnixMs?.() ?? 0,
  }
}

export async function promoteBackup(backupId: string): Promise<{ ok: boolean; message: string }> {
  const md = metadata()
  const rq = new bm.PromoteBackupRequest()
  rq.setBackupId(backupId)

  const rsp = await unary<bm.PromoteBackupRequest, bm.PromoteBackupResponse>(
    bmClient, 'promoteBackup', rq, undefined, md,
  )
  return { ok: rsp.getOk?.() ?? false, message: rsp.getMessage?.() ?? '' }
}

export async function demoteBackup(backupId: string): Promise<{ ok: boolean; message: string }> {
  const md = metadata()
  const rq = new bm.DemoteBackupRequest()
  rq.setBackupId(backupId)

  const rsp = await unary<bm.DemoteBackupRequest, bm.DemoteBackupResponse>(
    bmClient, 'demoteBackup', rq, undefined, md,
  )
  return { ok: rsp.getOk?.() ?? false, message: rsp.getMessage?.() ?? '' }
}

// ─── MinIO Bucket Management ────────────────────────────────────────────────

export interface MinioBucketInfo {
  name: string
  creationDate: string
  sizeBytes: number
  objectCount: number
}

export async function listMinioBuckets(): Promise<{ buckets: MinioBucketInfo[]; endpoint: string }> {
  const md = metadata()
  const rq = new bm.ListMinioBucketsRequest()

  const rsp = await unary<bm.ListMinioBucketsRequest, bm.ListMinioBucketsResponse>(
    bmClient, 'listMinioBuckets', rq, undefined, md,
  )
  return {
    buckets: (rsp.getBucketsList?.() ?? []).map((b: any) => ({
      name:         b.getName?.()         ?? '',
      creationDate: b.getCreationDate?.() ?? '',
      sizeBytes:    b.getSizeBytes?.()    ?? 0,
      objectCount:  b.getObjectCount?.()  ?? 0,
    })),
    endpoint: rsp.getEndpoint?.() ?? '',
  }
}

export async function createMinioBucket(opts: {
  name: string
  setAsBackupDestination?: boolean
  setAsScyllaLocation?: boolean
}): Promise<{ ok: boolean; message: string; bucketName: string }> {
  const md = metadata()
  const rq = new bm.CreateMinioBucketRequest()
  rq.setName(opts.name)
  if (opts.setAsBackupDestination) rq.setSetAsBackupDestination(true)
  if (opts.setAsScyllaLocation) rq.setSetAsScyllaLocation(true)

  const rsp = await unary<bm.CreateMinioBucketRequest, bm.CreateMinioBucketResponse>(
    bmClient, 'createMinioBucket', rq, undefined, md,
  )
  return {
    ok:         rsp.getOk?.()         ?? false,
    message:    rsp.getMessage?.()    ?? '',
    bucketName: rsp.getBucketName?.() ?? '',
  }
}

export async function deleteMinioBucket(opts: {
  name: string
  force?: boolean
}): Promise<{ ok: boolean; message: string }> {
  const md = metadata()
  const rq = new bm.DeleteMinioBucketRequest()
  rq.setName(opts.name)
  if (opts.force) rq.setForce(true)

  const rsp = await unary<bm.DeleteMinioBucketRequest, bm.DeleteMinioBucketResponse>(
    bmClient, 'deleteMinioBucket', rq, undefined, md,
  )
  return {
    ok:      rsp.getOk?.()      ?? false,
    message: rsp.getMessage?.() ?? '',
  }
}
