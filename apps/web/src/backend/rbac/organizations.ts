// backend/rbac/organizations.ts
// Refactor: use resource.ResourceService::GetOrganizations (server-streaming)

import { stream } from "../core/rpc"

// ---- Generated stubs (pick the variant that matches your node_modules) ----
// Variant A (common):
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"
// Variant B (if your package exposes ./resource/*):
// import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
// import * as resource from "globular-web-client/resource/resource_pb"
// ---------------------------------------------------------------------------

const SERVICE = "resource.ResourceService"
const factory = (addr: string) =>
  new ResourceServiceClient(addr, null, { withCredentials: true })

/**
 * Stream organizations with an optional JSON query.
 * Example queries:
 *  - `"{}"` (all)
 *  - `{"id":"org-123"}`
 *  - `{"name": {"$regex": "acme"}}`
 */
export async function streamOrganizations(
  query?: string,
  onChunk?: (msg: resource.GetOrganizationsRsp) => void,
  opts?: { base?: string }
): Promise<void> {
  const rq = new resource.GetOrganizationsRqst()
  if (query) (rq as any).setQuery?.(query)

  await stream<resource.GetOrganizationsRqst, resource.GetOrganizationsRsp>(
    factory,
    "getOrganizations",
    rq,
    (msg) => onChunk?.(msg),
    SERVICE,
    { base: opts?.base }
  )
}

/** Collect the whole stream into a flat array of Organization messages. */
export async function getAllOrganizations(
  query = "{}",
  opts?: { base?: string }
): Promise<resource.Organization[]> {
  const out: resource.Organization[] = []
  await streamOrganizations(query, (msg) => {
    const list: resource.Organization[] =
      (msg as any).getOrganizationslist?.() ||
      (msg as any).getOrganizationsList?.() ||
      []
    for (const org of list) out.push(org)
  }, opts)
  return out
}

/**
 * Get a single organization by id.
 * Returns `undefined` if not found.
 */
export async function getOrganizationById(
  id: string,
  opts?: { base?: string }
): Promise<resource.Organization | undefined> {
  if (!id) return undefined
  const results = await getAllOrganizations(`{"id":"${id}"}`, opts)
  return results[0]
}
