// packages/backend/src/metrics/adminMetrics.ts
//
// TypeScript types + fetch functions for the server-side
// /admin/metrics/services and /admin/metrics/storage endpoints.

// ─── Services endpoint types ────────────────────────────────────────────────

export interface ServicesResponse {
  now_unix_ms: number
  range: string
  prometheus: PromStatus
  thresholds: SvcThresholds
  groups: ServiceGroup[]
  summary: ServicesSummary
  infra?: Record<string, InfraDetail>
}

export interface PromStatus {
  connected: boolean
  addr: string
}

export interface SvcThresholds {
  cpu_warn_pct: number
  cpu_crit_pct: number
  mem_warn_pct: number
  mem_crit_pct: number
}

export interface ServiceGroup {
  category: string
  services: ServiceInstance[]
}

export interface ServiceInstance {
  name: string
  display_name: string
  id: string
  version: string
  state: string
  port: number
  category: string
  node: string
  derived_status: 'healthy' | 'degraded' | 'critical' | 'unknown'
  reasons: string[] | null
  runtime: SvcRuntime | null
  grpc_health: GRPCHealth | null
  /** Number of cluster nodes running this service (set by client dedup). */
  instance_count?: number
}

export interface SvcRuntime {
  cpu_pct: number
  memory_bytes: number
  uptime_sec: number
  req_rate: number
  err_rate: number
  latency_p50_ms: number
  latency_p95_ms: number
  goroutines: number
  heap_bytes: number
  open_fds: number
  max_fds: number
  msg_recv_rate: number
  msg_sent_rate: number
}

export interface GRPCHealth {
  enabled: boolean
  status: string
}

export interface InfraDetail {
  // etcd
  etcd_is_leader?: boolean
  etcd_db_size_bytes?: number
  etcd_total_keys?: number
  // envoy
  envoy_active_conns?: number
  envoy_rps?: number
  envoy_http_5xx?: number
  // node
  node_load1?: number
  node_load5?: number
  node_mem_avail_bytes?: number
  node_mem_total_bytes?: number
  node_net_rx_rate?: number
  node_net_tx_rate?: number
}

export interface ServicesSummary {
  total: number
  healthy: number
  degraded: number
  critical: number
  unknown: number
}

// ─── Storage endpoint types ─────────────────────────────────────────────────

export interface StorageResponse {
  now_unix_ms: number
  derived_status: 'healthy' | 'degraded' | 'critical'
  reasons: string[] | null
  most_critical_mount: string
  thresholds: StorageThresholds
  mounts: MountInfo[]
  applications: ApplicationPath[]
  series: Record<string, unknown>
}

export interface StorageThresholds {
  disk_warn_free_pct: number
  disk_crit_free_pct: number
}

export interface MountInfo {
  device: string
  mount_point: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  used_pct: number
  free_pct: number
  status: 'healthy' | 'degraded' | 'critical'
}

export interface ApplicationPath {
  name: string
  path: string
  exists: boolean
  writable: boolean
  mount_point: string
  status: 'healthy' | 'at_risk' | 'unavailable'
  size_bytes: number | null
}

// ─── Envoy endpoint types ───────────────────────────────────────────────────

export interface EnvoyResponse {
  now_unix_ms: number
  healthy: boolean
  prometheus: PromStatus
  server: EnvoyServer
  downstream: EnvoyDownstream
  clusters: EnvoyCluster[]
  listeners: EnvoyListener[]
  xds: EnvoyXDS
}

export interface EnvoyServer {
  state: string
  uptime_sec: number
  connections: number
  mem_allocated_bytes: number
  total_connections_lifetime: number
  hot_restart_epoch: number
  version: string
}

export interface EnvoyDownstream {
  active_conns: number
  rps: number
  http_2xx_rate: number
  http_4xx_rate: number
  http_5xx_rate: number
  rx_bytes_rate: number
  tx_bytes_rate: number
  ssl_conns: number
  ssl_handshake_rate: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  ssl_error_rate: number
  days_until_cert_expiry: number
}

export interface EnvoyCluster {
  name: string
  healthy: number
  degraded: number
  unhealthy: number
  rps: number
  err_rate: number
  p50_ms: number
  p99_ms: number
  active_conns: number
  rx_bytes_rate: number
  tx_bytes_rate: number
  retry_rate: number
  timeout_rate: number
  rx_reset_rate: number
  circuit_breaker_open: number
}

export interface EnvoyListener {
  address: string
  active_conns: number
  rps: number
  http_4xx_rate: number
  http_5xx_rate: number
  ssl_handshake_rate: number
  ssl_error_rate: number
}

export interface EnvoyXDS {
  active_clusters: number
  active_listeners: number
  cds_update_success: number
  cds_update_failure: number
  lds_update_success: number
  lds_update_failure: number
  routes: RDSRoute[]
}

export interface RDSRoute {
  name: string
  connected: number
  update_success: number
  update_failure: number
}

// ─── Fetch functions ────────────────────────────────────────────────────────

import { getBaseUrl } from "../core/endpoints"
import { metadata } from "../core/auth"

const _statusRank: Record<string, number> = { critical: 0, degraded: 1, unknown: 2, healthy: 3 }

/** Deduplicate services within a single node's response by name, keeping worst status. */
function _deduplicateGroups(groups: ServiceGroup[]): void {
  for (const g of groups) {
    const counts = new Map<string, number>()
    for (const s of g.services) counts.set(s.name, (counts.get(s.name) ?? 0) + 1)

    const best = new Map<string, ServiceInstance>()
    for (const s of g.services) {
      const prev = best.get(s.name)
      if (!prev || (_statusRank[s.derived_status] ?? 2) < (_statusRank[prev.derived_status] ?? 2)) {
        best.set(s.name, s)
      }
    }
    g.services = [...best.values()].map(s => ({
      ...s,
      instance_count: counts.get(s.name) ?? 1,
    }))
  }
}

function _recomputeSummary(data: ServicesResponse): void {
  let total = 0, healthy = 0, degraded = 0, critical = 0, unknown = 0
  for (const g of data.groups) {
    for (const s of g.services) {
      total++
      if (s.derived_status === 'healthy') healthy++
      else if (s.derived_status === 'degraded') degraded++
      else if (s.derived_status === 'critical') critical++
      else unknown++
    }
  }
  data.summary = { total, healthy, degraded, critical, unknown }
}

/**
 * Fetch and merge services from all cluster nodes.
 * nodeHostnames: list of node hostnames (e.g. ["globule-hp-01", "globule-dell"]).
 * When provided, each node's gateway is queried directly so services are
 * correctly attributed to their node. The local gateway's response is always
 * included (base param). Falls back to local-only when per-node queries fail.
 */
export async function fetchAdminServices(
  base?: string,
  nodeHostnames?: string[],
): Promise<ServicesResponse> {
  if (base == null) base = getBaseUrl() || ''

  // Fetch from local gateway first — always succeeds and provides schema/thresholds.
  const localResp = await fetch(`${base}/admin/metrics/services`)
  if (!localResp.ok) throw new Error(`admin/metrics/services: ${localResp.status}`)
  const localData: ServicesResponse = await localResp.json()
  _deduplicateGroups(localData.groups)

  if (!nodeHostnames?.length) {
    _recomputeSummary(localData)
    return localData
  }

  // Query each remote node's gateway in parallel, deduplicate, merge into localData.
  // Only include nodes whose hostname differs from the local node's services.
  const localNodeName = localData.groups[0]?.services[0]?.node ?? ''
  const remoteHosts = nodeHostnames.filter(h => h !== localNodeName)

  // Derive per-node base URL from the local base URL by replacing the node prefix.
  // e.g. base="https://globule-ryzen.globular.internal:8443", node="globule-hp-01"
  //   → "https://globule-hp-01.globular.internal:8443"
  let remoteUrlPrefix = ''
  try {
    const u = new URL(base)
    const hostSuffix = localNodeName && u.hostname.startsWith(localNodeName)
      ? u.hostname.slice(localNodeName.length)  // ".globular.internal"
      : u.hostname.includes('.') ? u.hostname.slice(u.hostname.indexOf('.')) : ''
    const port = u.port ? `:${u.port}` : ''
    remoteUrlPrefix = `${u.protocol}//{NODE}${hostSuffix}${port}`
  } catch { /* fall back to bare https below */ }

  const remoteResults = await Promise.allSettled(
    remoteHosts.map(async (hostname) => {
      const remoteBase = remoteUrlPrefix
        ? remoteUrlPrefix.replace('{NODE}', hostname)
        : `https://${hostname}`
      const resp = await fetch(`${remoteBase}/admin/metrics/services`, {
        headers: { ...metadata() },
      })
      if (!resp.ok) throw new Error(`${hostname}: ${resp.status}`)
      const d: ServicesResponse = await resp.json()
      _deduplicateGroups(d.groups)
      return d
    })
  )

  // Merge remote groups into localData by category, avoiding name+node duplicates.
  for (const res of remoteResults) {
    if (res.status !== 'fulfilled') continue
    for (const remoteGroup of res.value.groups) {
      let localGroup = localData.groups.find(g => g.category === remoteGroup.category)
      if (!localGroup) {
        localGroup = { category: remoteGroup.category, services: [] }
        localData.groups.push(localGroup)
      }
      const existing = new Set(localGroup.services.map(s => `${s.name}::${s.node}`))
      for (const s of remoteGroup.services) {
        if (!existing.has(`${s.name}::${s.node}`)) {
          localGroup.services.push(s)
          existing.add(`${s.name}::${s.node}`)
        }
      }
    }
  }

  _recomputeSummary(localData)
  return localData
}

export async function fetchAdminStorage(base?: string): Promise<StorageResponse> {
  if (base == null) base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/metrics/storage`)
  if (!resp.ok) throw new Error(`admin/metrics/storage: ${resp.status}`)
  return resp.json()
}

export async function fetchAdminEnvoy(base?: string): Promise<EnvoyResponse> {
  if (base == null) base = getBaseUrl() || ''
  const resp = await fetch(`${base}/admin/metrics/envoy`)
  if (!resp.ok) throw new Error(`admin/metrics/envoy: ${resp.status}`)
  return resp.json()
}

// ─── Service logs endpoint types ────────────────────────────────────────────

export interface ServiceLogsResponse {
  unit: string
  lines: string[] | null
  truncated: boolean
  timestamp: number
  error?: string
}

// ─── Service logs fetch ─────────────────────────────────────────────────────

export async function fetchAdminServiceLogs(
  unit: string,
  lines = 100,
  sinceSec = 3600,
  base?: string,
): Promise<ServiceLogsResponse> {
  if (base == null) base = getBaseUrl() || ''
  const params = new URLSearchParams({ unit, lines: String(lines), since: String(sinceSec) })
  const resp = await fetch(`${base}/admin/service/logs?${params}`)
  if (!resp.ok) throw new Error(`admin/service/logs: ${resp.status}`)
  return resp.json()
}
