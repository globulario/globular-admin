// /backend/services/actions.ts
// Fetch all available RPC actions via ServicesManagerService
// Mirrors the style used in backend/rbac/* modules.

import { unary } from "./rpc";
import { getBaseUrl } from "./endpoints";

// ---- Generated stubs (adjust paths if needed) ----
import { ServicesManagerServiceClient } from "globular-web-client/services_manager/services_manager_grpc_web_pb";
import * as sm from "globular-web-client/services_manager/services_manager_pb";

function clientFactory(): ServicesManagerServiceClient {
  const base = getBaseUrl() ?? "";
  return new ServicesManagerServiceClient(base, null, { withCredentials: true });
}

async function meta(): Promise<Record<string, string>> {
  try {
    const t = sessionStorage.getItem("__globular_token__");
    return t ? { token: t } : {};
  } catch {
    return {};
  }
}

/** List all actions the Services Manager knows about */
export async function listActions(): Promise<string[]> {
  const md = await meta();
  const rq = new sm.GetAllActionsRequest();

  // ServicesManagerService.getAllActions(GetAllActionsRequest) → GetAllActionsResponse
  const method = "getAllActions";
  const rsp: any = await unary(clientFactory, method, rq, undefined, md);

  const arr: string[] =
    (typeof rsp?.getActionsList === "function" && rsp.getActionsList()) ||
    (typeof rsp?.getActions === "function" && rsp.getActions()) ||
    rsp?.actions ||
    [];

  return arr.map(String).sort();
}