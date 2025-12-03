// endpoints.ts
type JSONValue = string | number | boolean | null | JSONObject | JSONArray;
interface JSONObject { [k: string]: JSONValue }
interface JSONArray extends Array<JSONValue> {}

export type ServiceDesc = { Name?: string; [k: string]: any };
export type GlobularConfig = { Services?: Record<string, ServiceDesc>; [k: string]: any };

const BASE_KEY = "globular.baseUrl";

// ---------- storage shim (works in browser & desktop wrapper) ----------
let memoryBase: string | null = null;

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

// ---------- base URL API ----------
export function hasBaseUrl(): boolean {
  return !!readBase();
}

export function getBaseUrl(): string | null {
  return readBase();
}

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
  const url = normalizeBase(raw);
  // Basic validation: must be http(s) scheme + host
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch {
    throw new Error(`Invalid base URL: ${raw}`);
  }
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

function normalizeBase(b: string): string {
  return b.replace(/\/+$/, ""); // strip trailing slash
}

// ---------- /config + service-paths cache ----------
let _cfgPromise: Promise<void> | null = null;
let _servicePaths: Record<string, string> | null = null;

async function loadConfigAndBuildMap(base: string) {
  const res = await fetch(safeJoin(base, "/config"));
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

// ---------- utils ----------
function safeJoin(base: string, path: string): string {
  if (base.endsWith("/")) base = base.slice(0, -1);
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

// endpoints.ts (you already have this now)
export function serviceHost(base = requireBaseUrl()): string {
  return base.replace(/\/+$/, '');
}