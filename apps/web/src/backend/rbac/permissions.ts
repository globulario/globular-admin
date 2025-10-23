// backend/rbac/permissions.ts
// Controller-style wrapper (matches the style of accounts.ts / groups.ts)

import { getBaseUrl } from "../core/endpoints";
import { unary } from "../core/rpc";

import { RbacServiceClient } from "globular-web-client/rbac/rbac_grpc_web_pb";
import {
  GetSharedResourceRqst,
  SubjectType,
} from "globular-web-client/rbac/rbac_pb";

// If your rpc.ts exposes a client factory already, you can replace this with it.
function client(base?: string) {
  const url = (base || getBaseUrl() || "").replace(/\/+$/, "");
  return new RbacServiceClient(url, null, null);
}

const SERVICE_NAME = "rbac.RbacService";

export const SERVICE_METHODS = {
  getSharedResource: {
    method: "getSharedResource",
    rq: GetSharedResourceRqst,
  },
} as const;

/**
 * List resources shared with a subject (account/group/role).
 */
export async function getSharedResources(args: {
  subject: string;        // e.g. "user@domain"
  type: SubjectType;      // SubjectType.ACCOUNT | GROUP | ROLE
  base?: string;          // optional alternate base URL
  md?: Record<string, string>; // caller-provided metadata (token, domain) if you pass it
}) {
  const c = client(args.base);
  const rq = new SERVICE_METHODS.getSharedResource.rq();
  rq.setSubject(args.subject);
  rq.setType(args.type);

  // `unary` signature you’re using elsewhere: unary(client, methodName, request, serviceName?, metadata?)
  const rsp: any = await unary(
    c as any,
    SERVICE_METHODS.getSharedResource.method,
    rq,
    undefined,
    args.md
  );
  return rsp; // caller can .getSharedresourceList()
}

export { SubjectType };
