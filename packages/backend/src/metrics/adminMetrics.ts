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

export async function fetchAdminServices(base = ''): Promise<ServicesResponse> {
  const resp = await fetch(`${base}/admin/metrics/services`)
  if (!resp.ok) throw new Error(`admin/metrics/services: ${resp.status}`)
  return resp.json()
}

export async function fetchAdminStorage(base = ''): Promise<StorageResponse> {
  const resp = await fetch(`${base}/admin/metrics/storage`)
  if (!resp.ok) throw new Error(`admin/metrics/storage: ${resp.status}`)
  return resp.json()
}

export async function fetchAdminEnvoy(base = ''): Promise<EnvoyResponse> {
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
  base = '',
): Promise<ServiceLogsResponse> {
  const params = new URLSearchParams({ unit, lines: String(lines), since: String(sinceSec) })
  const resp = await fetch(`${base}/admin/service/logs?${params}`)
  if (!resp.ok) throw new Error(`admin/service/logs: ${resp.status}`)
  return resp.json()
}
