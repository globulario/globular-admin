// /backend/services/actions.ts
// Fetch all available RPC actions via ServicesManagerService
// Mirrors the style used in backend/rbac/* modules.

import { unary } from "./rpc";
import { grpcWebHostUrl } from "./endpoints";

// ---- Generated stubs (adjust paths if needed) ----
import * as smGrpc from "globular-web-client/services_manager/services_manager_grpc_web_pb";
import * as sm from "globular-web-client/services_manager/services_manager_pb";

function clientFactory(): smGrpc.ServicesManagerServiceClient {
  const base = grpcWebHostUrl();
  return new smGrpc.ServicesManagerServiceClient(base, null, { withCredentials: true });
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

// ─── Service Instances ────────────────────────────────────────────────────────

export type ServiceInstanceVM = {
  id:           string
  name:         string
  description:  string
  domain:       string
  version:      string
  port:         number
  proxyPort:    number
  state:        string   // "running" | "stopped" | "closing"
  process:      number   // PID, -1 if not running
  proxyProcess: number
  lastError:    string
  keepAlive:    boolean
  keepUpToDate: boolean
  publisherId:  string
}

function structToPlain(s: any): Record<string, any> {
  if (typeof s?.toJavaScript === "function") return s.toJavaScript() as Record<string, any>
  if (typeof s?.toObject    === "function") return s.toObject()     as Record<string, any>
  return {}
}

function gf(obj: any, key: string, alt: any = ""): any {
  const v = obj?.[key]
  return v !== undefined && v !== null ? v : alt
}

function toServiceInstanceVM(raw: any): ServiceInstanceVM {
  return {
    id:           String(gf(raw, "Id",           "")),
    name:         String(gf(raw, "Name",         "")),
    description:  String(gf(raw, "Description",  "")),
    domain:       String(gf(raw, "Domain",        "")),
    version:      String(gf(raw, "Version",       "")),
    port:         Number(gf(raw, "Port",          0)),
    proxyPort:    Number(gf(raw, "ProxyPort",     0)),
    state:        String(gf(raw, "State",         "stopped")),
    process:      Number(gf(raw, "Process",       -1)),
    proxyProcess: Number(gf(raw, "ProxyProcess",  -1)),
    lastError:    String(gf(raw, "LastError",     "")),
    keepAlive:    Boolean(gf(raw, "KeepAlive",    false)),
    keepUpToDate: Boolean(gf(raw, "KeepUpToDate", false)),
    publisherId:  String(gf(raw, "PublisherId",   "")),
  }
}

/** Fetch the full list of service instance configs from ServicesManager. */
export async function getServicesConfiguration(): Promise<ServiceInstanceVM[]> {
  const md = await meta()
  const rq = new sm.GetServicesConfigurationRequest()
  const rsp: any = await unary(clientFactory, "getServicesConfiguration", rq, undefined, md)
  const structs: any[] = rsp?.getServicesList?.() ?? rsp?.services ?? []
  return structs.map(s => toServiceInstanceVM(structToPlain(s)))
}

/** Start a stopped service instance by its Id. */
export async function startService(serviceId: string): Promise<void> {
  const md = await meta()
  const rq = new sm.StartServiceInstanceRequest()
  rq.setServiceId(serviceId)
  await unary(clientFactory, "startServiceInstance", rq, undefined, md)
}

/** Stop a running service instance by its Id. */
export async function stopService(serviceId: string): Promise<void> {
  const md = await meta()
  const rq = new sm.StopServiceInstanceRequest()
  rq.setServiceId(serviceId)
  await unary(clientFactory, "stopServiceInstance", rq, undefined, md)
}

/** Restart every service on this node. */
export async function restartAllServices(): Promise<void> {
  const md = await meta()
  const rq = new sm.RestartAllServicesRequest()
  await unary(clientFactory, "restartAllServices", rq, undefined, md)
}
