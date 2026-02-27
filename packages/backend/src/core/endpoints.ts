// endpoints.ts
type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
interface JSONObject { [k: string]: JSONValue }
interface JSONArray extends Array<JSONValue> {}

export type ServiceDesc = { Name?: string; [k: string]: any };
export type GlobularConfig = { Services?: Record<string, ServiceDesc>; [k: string]: any };

const BASE_KEY = "globular.baseUrl";           // gateway / app listener
const CONFIG_BASE_KEY = "globular.configBase"; // optional bootstrap/config listener
const ROUTING_KEY = "globular.routingMode";

export type RoutingMode = "path" | "subdomain";

// ---------- storage shim (works in browser & desktop wrapper) ----------
let memoryBase: string | null = null;
let memoryRouting: RoutingMode | null = null;
let memoryConfigBase: string | null = null;
let warnedPathyGrpcHost = false;

function readBase(): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(BASE_KEY);
    }
  } catch {}
  return memoryBase;
}

function writeBase(url: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (url == null) localStorage.removeItem(BASE_KEY);
      else localStorage.setItem(BASE_KEY, url);
      return;
    }
  } catch {}
  memoryBase = url;
}

function readConfigBase(): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(CONFIG_BASE_KEY);
    }
  } catch {}
  return memoryConfigBase;
}

function writeConfigBase(url: string | null) {
  try {
    if (typeof localStorage !== "undefined") {
      if (url == null) localStorage.removeItem(CONFIG_BASE_KEY);
      else localStorage.setItem(CONFIG_BASE_KEY, url);
      return;
    }
  } catch {}
  memoryConfigBase = url;
}

function readRouting(): RoutingMode | null {
  try {
    if (typeof localStorage !== "undefined") {
      const v = localStorage.getItem(ROUTING_KEY);
      if (v === "path" || v === "subdomain") return v;
    }
  } catch {}
  return memoryRouting;
}

function writeRouting(mode: RoutingMode) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ROUTING_KEY, mode);
      return;
    }
  } catch {}
  memoryRouting = mode;
}

// ---------- base URL API ----------
export function hasBaseUrl(): boolean {
  return !!readBase();
}

export function getBaseUrl(): string | null {
  return readBase();
}
export function getGatewayBaseUrl(): string | null { return getBaseUrl(); }

export function requireBaseUrl(): string {
  const v = readBase();
  if (!v) {
    throw new Error(
      "No Globular base URL configured. Call setBaseUrl('https://your-host') before using the client."
    );
  }
  return v;
}

export function setBaseUrl(raw: string) {
  if (!raw || typeof raw !== "string") throw new Error("Invalid base URL");
  const url = normalizeGatewayBase(raw);
  writeBase(url);
  // reset caches tied to base
  _cfgPromise = null;
  _servicePaths = null;
}

export function clearBaseUrl() {
  writeBase(null);
  _cfgPromise = null;
  _servicePaths = null;
}

export function setConfigBaseUrl(raw: string | null) {
  if (raw == null || raw === "") {
    writeConfigBase(null);
    return;
  }
  const url = normalizeBase(raw);
  writeConfigBase(url);
}

export function getConfigBaseUrl(): string | null {
  return readConfigBase();
}

function normalizeBase(b: string): string {
  return b.replace(/\/+$/, ""); // strip trailing slash
}

function normalizeGatewayBase(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`Invalid base URL: ${raw}`); }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.port === "80") u.port = "";
  return normalizeBase(u.toString());
}

/**
 * Host-only URL for grpc-web clients.
 * Strips any path/query/fragment and warns once if a path was present.
 */
export function grpcWebHostUrl(base = requireBaseUrl()): string {
  const b = base ?? '';
  try {
    const u = new URL(b);
    const hadPath = u.pathname && u.pathname !== '/';
    if (hadPath && !warnedPathyGrpcHost) {
      console.warn("[globular-sdk] grpcWebHostUrl stripping path from base URL:", b);
      warnedPathyGrpcHost = true;
    }
    u.pathname = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return b.replace(/\/+$/, '');
  }
}

// ---------- routing mode API ----------
export function getRoutingMode(): RoutingMode {
  const v = readRouting();
  return v === "subdomain" ? "subdomain" : "path";
}

export function setRoutingMode(mode: RoutingMode): void {
  if (mode !== "path" && mode !== "subdomain") {
    throw new Error("Invalid routing mode");
  }
  writeRouting(mode);
}

// ---------- /config + service-paths cache ----------
let _cfgPromise: Promise<void> | null = null;
let _servicePaths: Record<string, string> | null = null;

async function loadConfigAndBuildMap(base: string) {
  const cfgBase = getConfigBaseUrl() ?? base;
  const res = await fetch(safeJoin(cfgBase, "/config"));
  if (!res.ok) throw new Error(`fetch /config failed: ${res.status}`);
  const cfg = (await res.json()) as GlobularConfig;

  const paths: Record<string, string> = {};
  const svcs = cfg.Services || {};
  for (const id of Object.keys(svcs)) {
    const s = svcs[id];
    if (s?.Name) paths[s.Name] = `/${s.Name}`;
  }
  _servicePaths = paths;
}

// Start one in-flight fetch per base (lazy).
function ensureConfigKickoff(base: string) {
  if (!_cfgPromise) {
    _cfgPromise = loadConfigAndBuildMap(base).catch(() => { /* keep fallback; no crash */ }).then(() => {});
  }
}

/** Manually refresh endpoints (await this at app boot if you want). */
export async function refreshEndpoints(base = requireBaseUrl()): Promise<void> {
  _cfgPromise = null;
  _servicePaths = null;
  await loadConfigAndBuildMap(base).catch(() => {});
}

/** Optional: access the raw /config (no cache) */
export async function getConfig(base = requireBaseUrl()): Promise<GlobularConfig | null> {
  try {
    const res = await fetch(safeJoin(base, "/config"));
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as GlobularConfig;
  } catch {
    return null;
  }
}

/**
 * Patch a service's configuration.  Only the supplied fields are changed;
 * the backend fetches the current config and merges the patch before saving.
 * Desired fields (Domain, Port, …) go to etcd /config; runtime fields
 * (State, Process, ProxyProcess) go to etcd /runtime.
 * Requires Id in the patch.
 */
export async function saveServiceConfig(
  patch: Partial<ServiceDesc> & { Id: string },
  base = requireBaseUrl(),
): Promise<void> {
  const token = sessionStorage.getItem("__globular_token__") ?? "";
  const res = await fetch(safeJoin(base, "/api/save-service-config"), {
    method:  "POST",
    headers: { "Content-Type": "application/json", token },
    body:    JSON.stringify(patch),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`save-service-config: ${res.status} — ${msg}`);
  }
}

// ---------- URL builder ----------
/**
 * Resolve the service URL for a given gRPC service id, e.g. "authentication.AuthenticationService".
 * Requires setBaseUrl() to have been called at least once.
 *
 * Strategy:
 *  - Kick off a lazy /config fetch to learn exact gateway paths.
 *  - Return `${base}/<serviceId>` immediately (safe gateway fallback).
 *  - Once /config is loaded, subsequent calls will use the exact path from the map.
 */
export function serviceUrl(serviceId: string, base = requireBaseUrl()): string {
  ensureConfigKickoff(base);
  const path = _servicePaths?.[serviceId] ?? `/${serviceId}`;
  return safeJoin(base, path);
}

/**
 * Resolve the base URL for a service using the current routing mode.
 * Defaults to path-based routing.
 */
export function serviceBaseUrl(serviceId: string, base = requireBaseUrl()): string {
  if (base.startsWith("http://") || base.includes(":80")) {
    throw new Error(`Insecure or bootstrap base URL not allowed for services: ${base}`);
  }
  const mode = getRoutingMode();
  return mode === "subdomain"
    ? serviceSubdomainUrl(serviceId, base)
    : serviceUrl(serviceId, base);
}

// ---------- utils ----------
function safeJoin(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

// endpoints.ts (you already have this now)
export function serviceHost(base = requireBaseUrl()): string {
  return base.replace(/\/+$/, '');
}

/**
 * Derive the gRPC-web base URL for a specific service using subdomain routing.
 *
 * Maps "authentication.AuthenticationService" → "https://authentication.domain.com"
 * by extracting the package prefix (the part before the first dot) as the subdomain
 * and stripping the first host label from the base URL to get the root domain.
 *
 * Examples (base = "https://www.globular.cloud"):
 *   serviceSubdomainUrl("authentication.AuthenticationService") → "https://authentication.globular.cloud"
 *   serviceSubdomainUrl("resource.ResourceService")            → "https://resource.globular.cloud"
 *
 * Falls back to the plain base URL for localhost or bare IP addresses so that
 * the Vite dev proxy (path-based routing) keeps working unchanged in development.
 */
export function serviceSubdomainUrl(serviceFullName: string, base?: string): string {
  const b = base ?? getBaseUrl() ?? ''
  if (!b) return ''
  try {
    const u = new URL(b)
    const h = u.hostname
    // Localhost or bare IP → path-based routing (dev proxy)
    if (h === 'localhost' || /^[\d.:]+$/.test(h)) {
      return b.replace(/\/+$/, '')
    }
    // Short service key: "authentication.AuthenticationService" → "authentication"
    const serviceKey = serviceFullName.split('.')[0].toLowerCase()
    // Root domain: strip the outermost host label
    //   www.globular.cloud → globular.cloud
    //   globular.cloud     → globular.cloud  (only 2 parts, keep as-is)
    const parts = h.split('.')
    const domain = parts.length > 2 ? parts.slice(1).join('.') : h
    const port = u.port ? ':' + u.port : ''
    return `${u.protocol}//${serviceKey}.${domain}${port}`
  } catch {
    return b.replace(/\/+$/, '')
  }
}
