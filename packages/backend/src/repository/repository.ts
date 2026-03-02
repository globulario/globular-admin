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
import { metadata }       from '../core/auth'
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
