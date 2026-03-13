// repository.ts — gRPC-web client for the Repository PackageRepository service.
//
// Wraps ListArtifacts and GetArtifactManifest so the catalog page can browse
// available artifacts without depending on the incomplete globular-web-client
// stubs (which only expose DownloadBundle/UploadBundle).

import * as repoGrpc from 'globular-web-client/repository/repository_grpc_web_pb'
// Type-only import: erased at compile time, used only for TS type checking.
// At runtime, repoGrpc IS proto.repository (module.exports = proto.repository in
// repository_grpc_web_pb.js), which already includes all message classes from
// repository_pb.js via: proto.repository = require('./repository_pb.js').
// This avoids a dual ESM+CJS import of repository_pb that confuses Rollup's CJS plugin.
import type * as repoPb from 'globular-web-client/repository/repository_pb'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata, getStoredTokenSync } from '../core/auth'
import { unary }          from '../core/rpc'

// Runtime access to pb message classes through the grpc module (which merges them in).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pb = repoGrpc as any

// ── re-exports for callers ───────────────────────────────────────────────────

export type ArtifactRef      = repoPb.ArtifactRef.AsObject
export type ArtifactManifest = repoPb.ArtifactManifest.AsObject
export type BundleSummary    = repoPb.BundleSummary.AsObject

export const ArtifactKind: typeof repoPb.ArtifactKind = pb.ArtifactKind

// ── client factory ───────────────────────────────────────────────────────────

function repoClient(): repoGrpc.PackageRepositoryClient {
  const addr = grpcWebHostUrl()
  return new repoGrpc.PackageRepositoryClient(addr, null, { withCredentials: true })
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * List all artifact manifests stored in the repository.
 * Returns an empty array if the repository is empty or unreachable (caller
 * should check separately whether the service is reachable).
 */
export async function listArtifacts(): Promise<ArtifactManifest[]> {
  const md  = metadata()
  const rq  = new pb.ListArtifactsRequest()
  const rsp = await unary<repoPb.ListArtifactsRequest, repoPb.ListArtifactsResponse>(
    repoClient, 'listArtifacts', rq, undefined, md,
  )
  return rsp.getArtifactsList().map((m: repoPb.ArtifactManifest) => m.toObject())
}

/**
 * List all bundles published to the repository.
 * Returns an empty array if the repository has no bundles or is unreachable.
 */
export async function listBundles(): Promise<BundleSummary[]> {
  const md  = metadata()
  const rq  = new pb.ListBundlesRequest()
  const rsp = await unary<repoPb.ListBundlesRequest, repoPb.ListBundlesResponse>(
    repoClient, 'listBundles', rq, undefined, md,
  )
  return rsp.getBundlesList().map((b: repoPb.BundleSummary) => b.toObject())
}

/**
 * Fetch the manifest for a specific artifact by its ArtifactRef fields.
 * Returns null if the artifact is not found.
 */
export async function getArtifactManifest(ref: ArtifactRef): Promise<ArtifactManifest | null> {
  const md  = metadata()
  const r   = new pb.ArtifactRef()
  r.setPublisherId(ref.publisherId)
  r.setName(ref.name)
  r.setVersion(ref.version)
  r.setPlatform(ref.platform)
  r.setKind(ref.kind)
  const rq  = new pb.GetArtifactManifestRequest()
  rq.setRef(r)
  const rsp = await unary<repoPb.GetArtifactManifestRequest, repoPb.GetArtifactManifestResponse>(
    repoClient, 'getArtifactManifest', rq, undefined, md,
  )
  return rsp.getManifest()?.toObject() ?? null
}

// ── Search / Version History / Delete (Phase 2) ─────────────────────────────

export interface SearchArtifactsOpts {
  query?: string
  kind?: number
  publisher?: string
  platform?: string
  pageToken?: string
  pageSize?: number
}

/**
 * Search artifacts with optional filters (free-text, kind, publisher, platform).
 * Supports pagination via pageToken / pageSize.
 */
export async function searchArtifacts(opts: SearchArtifactsOpts = {}): Promise<{
  artifacts: ArtifactManifest[]
  totalCount: number
  nextPageToken: string
}> {
  const md = metadata()
  const rq = new pb.SearchArtifactsRequest()
  if (opts.query)     rq.setQuery(opts.query)
  if (opts.kind)      rq.setKind(opts.kind)
  if (opts.publisher) rq.setPublisherId(opts.publisher)
  if (opts.platform)  rq.setPlatform(opts.platform)
  if (opts.pageSize)  rq.setPageSize(opts.pageSize)
  if (opts.pageToken) rq.setPageToken(opts.pageToken)
  const rsp = await unary<repoPb.SearchArtifactsRequest, repoPb.SearchArtifactsResponse>(
    repoClient, 'searchArtifacts', rq, undefined, md,
  )
  return {
    artifacts:     rsp.getArtifactsList().map((m: repoPb.ArtifactManifest) => m.toObject()),
    totalCount:    rsp.getTotalCount(),
    nextPageToken: rsp.getNextPageToken(),
  }
}

/**
 * Fetch all versions of a given artifact (publisher + name).
 * Optionally filter by platform.
 */
export async function getArtifactVersions(
  publisher: string,
  name: string,
  platform?: string,
): Promise<ArtifactManifest[]> {
  const md = metadata()
  const rq = new pb.GetArtifactVersionsRequest()
  rq.setPublisherId(publisher)
  rq.setName(name)
  if (platform) rq.setPlatform(platform)
  const rsp = await unary<repoPb.GetArtifactVersionsRequest, repoPb.GetArtifactVersionsResponse>(
    repoClient, 'getArtifactVersions', rq, undefined, md,
  )
  return rsp.getVersionsList().map((m: repoPb.ArtifactManifest) => m.toObject())
}

/**
 * Delete a specific artifact version from the repository catalog.
 * Set force=true to delete even if nodes still have it installed.
 */
export async function deleteArtifact(
  ref: ArtifactRef,
  force = false,
): Promise<{ deleted: boolean; message: string }> {
  const md = metadata()
  const r  = new pb.ArtifactRef()
  r.setPublisherId(ref.publisherId)
  r.setName(ref.name)
  r.setVersion(ref.version)
  r.setPlatform(ref.platform)
  r.setKind(ref.kind)
  const rq = new pb.DeleteArtifactRequest()
  rq.setRef(r)
  rq.setForce(force)
  const rsp = await unary<repoPb.DeleteArtifactRequest, repoPb.DeleteArtifactResponse>(
    repoClient, 'deleteArtifact', rq, undefined, md,
  )
  return { deleted: rsp.getResult(), message: rsp.getMessage() }
}

// ── SetArtifactState ─────────────────────────────────────────────────────

/**
 * Change the lifecycle state of a specific artifact version.
 * Requires namespace write access (publisher) or admin role (quarantine/revoke).
 */
export async function setArtifactState(
  ref: ArtifactRef,
  buildNumber: number,
  targetState: number,
  reason = '',
): Promise<{ previousState: number; currentState: number }> {
  const md = metadata()
  const r  = new pb.ArtifactRef()
  r.setPublisherId(ref.publisherId)
  r.setName(ref.name)
  r.setVersion(ref.version)
  r.setPlatform(ref.platform)
  r.setKind(ref.kind)
  const rq = new pb.SetArtifactStateRequest()
  rq.setRef(r)
  rq.setBuildNumber(buildNumber)
  rq.setTargetState(targetState)
  rq.setReason(reason)
  const rsp = await unary<repoPb.SetArtifactStateRequest, repoPb.SetArtifactStateResponse>(
    repoClient, 'setArtifactState', rq, undefined, md,
  )
  return {
    previousState: rsp.getPreviousState(),
    currentState:  rsp.getCurrentState(),
  }
}

// ── Publish state constants ──────────────────────────────────────────────

export const PublishState = {
  UNKNOWN:      0,
  STAGING:      1,
  VERIFIED:     2,
  PUBLISHED:    3,
  FAILED:       4,
  SUPERSEDED:   5,
  DEPRECATED:   6,
  YANKED:       7,
  QUARANTINED:  8,
  REVOKED:      9,
} as const

export function publishStateLabel(state: number): string {
  switch (state) {
    case PublishState.STAGING:      return 'Staging'
    case PublishState.VERIFIED:     return 'Verified'
    case PublishState.PUBLISHED:    return 'Published'
    case PublishState.FAILED:       return 'Failed'
    case PublishState.SUPERSEDED:   return 'Superseded'
    case PublishState.DEPRECATED:   return 'Deprecated'
    case PublishState.YANKED:       return 'Yanked'
    case PublishState.QUARANTINED:  return 'Quarantined'
    case PublishState.REVOKED:      return 'Revoked'
    default:                        return 'Unknown'
  }
}

export function publishStateColor(state: number): string {
  switch (state) {
    case PublishState.PUBLISHED:    return '#16a34a'  // green
    case PublishState.DEPRECATED:   return '#ca8a04'  // yellow
    case PublishState.YANKED:       return '#ea580c'  // orange
    case PublishState.QUARANTINED:  return '#dc2626'  // red
    case PublishState.REVOKED:      return '#7f1d1d'  // dark red
    case PublishState.STAGING:      return '#6b7280'  // gray
    case PublishState.VERIFIED:     return '#2563eb'  // blue
    case PublishState.FAILED:       return '#dc2626'  // red
    default:                        return '#6b7280'
  }
}

// ── REST: state alignment ────────────────────────────────────────────────────

export interface PackageAlignmentStatus {
  name: string
  kind: string
  status: string           // aligned, drifted, missing_in_repo, unmanaged
  installed_version?: string
  repo_version?: string
  message?: string
}

export interface StateAlignmentReport {
  packages: PackageAlignmentStatus[]
  aligned: number
  drifted: number
  unmanaged: number
  missing_in_repo: number
  repository_addr?: string
}

/**
 * Fetch the 4-layer state alignment report from the admin REST endpoint.
 * Cross-references installed-state registry with repository artifacts.
 */
export async function fetchStateAlignment(base = ''): Promise<StateAlignmentReport> {
  const token = getStoredTokenSync() ?? ''
  const resp  = await fetch(`${base}/admin/state-alignment`, {
    headers: token ? { token } : {},
  })
  if (!resp.ok) throw new Error(`admin/state-alignment: HTTP ${resp.status}`)
  return resp.json()
}

// ── REST: installed packages ─────────────────────────────────────────────────

export interface InstalledPackage {
  name: string
  publisher: string
  version: string
  buildNumber?: number
  platform: string
  kind: string
  installedAt: string
  nodeId: string
}

/**
 * Fetch installed packages from the admin REST endpoint.
 * Optionally filter by nodeId and/or kind.
 */
export async function fetchInstalledPackages(
  nodeId?: string,
  kind?: string,
  base = '',
): Promise<InstalledPackage[]> {
  const params = new URLSearchParams()
  if (nodeId) params.set('nodeId', nodeId)
  if (kind)   params.set('kind', kind)
  const qs    = params.toString()
  const url   = `${base}/admin/packages${qs ? '?' + qs : ''}`
  const token = getStoredTokenSync() ?? ''
  const resp  = await fetch(url, {
    headers: token ? { token } : {},
  })
  if (!resp.ok) throw new Error(`admin/packages: HTTP ${resp.status}`)
  const data = await resp.json()
  return data.packages ?? data ?? []
}
