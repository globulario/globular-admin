// backend/rbac/groups.ts
// Refactor: use resource.ResourceService::GetGroups (server-streaming)

import { stream } from "../core/rpc"

// ---- Generated stubs (adjust these two paths to your package layout) ----
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
// If your package exposes ./resource/* instead of ./dist/gen/*, use:
// import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"

import * as resource from "globular-web-client/resource/resource_pb"
// Or: import * as resource from "globular-web-client/resource/resource_pb"

// ------------------------------------------------------------------------

const SERVICE = "resource.ResourceService"
const factory = (addr: string) =>
  new ResourceServiceClient(addr, null, { withCredentials: true })

/**
 * Stream groups with an optional JSON query (as defined by your proto).
 * Example query: `{"_id":"admins"}` or `{ "name": { "$regex": "dev" } }`
 *
 * onChunk receives each GetGroupsRsp message; extract groups via getGroupsList().
 *
 * You can optionally pass `base` to route to a different endpoint (multi-domain).
 */
export async function streamGroups(
  query?: string,
  onChunk?: (msg: resource.GetGroupsRsp) => void,
  opts?: { base?: string }
): Promise<void> {
  const rq = new resource.GetGroupsRqst()
  if (query) (rq as any).setQuery?.(query)

  await stream<resource.GetGroupsRqst, resource.GetGroupsRsp>(
    factory,
    "getGroups",
    rq,
    (msg) => onChunk?.(msg),
    SERVICE,
    { base: opts?.base }
  )
}

/**
 * Convenience: collect all groups that match a query into an array.
 * If your response exposes groups via getGroupsList(), we flatten all chunks.
 */
export async function getAllGroups(
  query?: string,
  opts?: { base?: string }
): Promise<resource.Group[]> {
  const out: resource.Group[] = []
  await streamGroups(query, (msg) => {
    const list: resource.Group[] =
      (msg as any).getGroupslist?.() || (msg as any).getGroupsList?.() || []
    for (const g of list) out.push(g)
  }, opts)
  return out
}

/**
 * Get a single group by id. Supports "id@domain" form:
 * - If given "editors@foo.com", we will query `_id: "editors"` and let the caller
 *   optionally pass a `base` override for that domain (via opts).
 */
export async function getGroupById(
  idWithOptionalDomain: string,
  opts?: { base?: string }
): Promise<resource.Group | undefined> {
  let id = idWithOptionalDomain
  // If you want to compute `base` from domain, you can parse it here:
  // e.g., const [rid, domain] = idWithOptionalDomain.split("@")
  // and map domain -> base URL using your own registry.
  if (id.includes("@")) {
    id = id.split("@")[0]
  }

  const groups = await getAllGroups(`{"_id":"${id}"}`, opts)
  return groups[0]
}
