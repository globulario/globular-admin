// backend/rbac/accounts.ts
// Uses resource.ResourceService::GetAccounts (server-streaming).
// Adjust ONLY the import paths if your package exposes a different folder layout.
import { stream } from "../core/rpc"

// Generated stubs from your npm package:
import { ResourceServiceClient } from "globular-web-client/resource/resource_grpc_web_pb"
import * as resource from "globular-web-client/resource/resource_pb"

// Service + client factory
const SERVICE = "resource.ResourceService"
const factory = (addr: string) =>
  new ResourceServiceClient(addr, null, { withCredentials: true })

/**
 * Stream accounts from the backend (server-streaming).
 * If your proto defines filter/paging fields, pass them in `params`.
 *
 * Example usage:
 *   await streamAccounts({ filter: "active", pageSize: 100 }, (msg) => {
 *     const accounts = msg.getAccountsList?.() ?? []
 *     console.log("chunk:", accounts.map(a => a.toObject?.() ?? a))
 *   })
 */
export async function streamAccounts(
  params: {
    filter?: string
    pageSize?: number
    offset?: number
  } = {},
  onChunk?: (msg: resource.GetAccountsRsp) => void
): Promise<void> {
  const rq = new resource.GetAccountsRqst()
  // Set optional fields if your proto supports them (safe-checked):
  if (params.filter !== undefined) (rq as any).setFilter?.(params.filter)
  if (params.pageSize !== undefined) (rq as any).setPagesize?.(params.pageSize) || (rq as any).setPageSize?.(params.pageSize)
  if (params.offset !== undefined) (rq as any).setOffset?.(params.offset)

  await stream<resource.GetAccountsRqst, resource.GetAccountsRsp>(
    factory,
    "getAccounts",
    rq,
    (msg) => onChunk?.(msg),
    SERVICE
  )
}

/**
 * Convenience helper: collect the whole GetAccounts stream and return a flat array.
 * This assumes GetAccountsRsp has a repeated field (e.g., accounts) accessible via
 * getAccountsList(). If the field name differs, tweak the extraction line accordingly.
 */
export async function getAllAccounts(
  params: {
    filter?: string
    pageSize?: number
    offset?: number
  } = {}
): Promise<any[]> {
  const out: any[] = []
  await streamAccounts(params, (msg) => {
    const list = (msg as any).getAccountslist?.() || (msg as any).getAccountsList?.() || []
    for (const a of list) out.push(a.toObject?.() ?? a)
  })
  return out
}
