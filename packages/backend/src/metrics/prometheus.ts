// packages/backend/src/metrics/prometheus.ts
//
// Thin wrapper around the Monitoring gRPC service that queries Prometheus.
// Handles connection bootstrapping transparently: creates a default
// "local" connection to localhost:9090 on first use.

import { unary, stream } from '../core/rpc'
import { grpcWebHostUrl } from '../core/endpoints'
import { metadata } from '../core/auth'
import * as monGrpc from 'globular-web-client/monitoring/monitoring_grpc_web_pb'
import * as monPb from 'globular-web-client/monitoring/monitoring_pb'

// ─── Connection bootstrap ────────────────────────────────────────────────────

const DEFAULT_CONN_ID = 'local'
const PROMETHEUS_HOST = 'localhost'
const PROMETHEUS_PORT = 9090

let _connReady: Promise<boolean> | null = null
let _connOk = false

function client(): monGrpc.MonitoringServiceClient {
  return new monGrpc.MonitoringServiceClient(grpcWebHostUrl(), null, { withCredentials: false })
}

/**
 * Ensure a default Prometheus connection exists in the monitoring service.
 * If creation fails (e.g. already exists), we still attempt queries.
 * Returns true if the connection is likely usable.
 */
async function ensureConnection(): Promise<boolean> {
  if (_connOk) return true
  if (_connReady) return _connReady

  _connReady = (async () => {
    try {
      const rq = new monPb.CreateConnectionRqst()
      const conn = new monPb.Connection()
      conn.setId(DEFAULT_CONN_ID)
      conn.setHost(PROMETHEUS_HOST)
      conn.setPort(PROMETHEUS_PORT)
      conn.setStore(monPb.StoreType.PROMETHEUS)
      rq.setConnection(conn)

      await unary<monPb.CreateConnectionRqst, monPb.CreateConnectionRsp>(
        client, 'createConnection', rq, undefined, metadata(),
      )
      _connOk = true
      return true
    } catch {
      // Connection may already exist — that's fine, try using it
      _connOk = true
      return true
    }
  })()

  return _connReady
}

// ─── Prometheus query types ──────────────────────────────────────────────────

export interface PromInstantResult {
  metric: Record<string, string>
  value: [number, string]
}

export interface PromQueryResponse {
  resultType: string
  result: PromInstantResult[]
}

// ─── Query API ───────────────────────────────────────────────────────────────

/**
 * Execute an instant PromQL query.
 * Tries the direct Prometheus HTTP API first (via /prometheus proxy in dev,
 * or same-origin /prometheus in production). Falls back to the Monitoring
 * gRPC service if the direct path is unavailable.
 */
export async function queryPrometheus(query: string): Promise<PromQueryResponse | null> {
  // Try direct HTTP first — faster and more reliable
  try {
    const url = `/prometheus/api/v1/query?query=${encodeURIComponent(query)}`
    const resp = await fetch(url)
    if (resp.ok) {
      const json = await resp.json()
      if (json.status === 'success' && json.data) return json.data
    }
  } catch { /* fall through to gRPC */ }

  // Fallback: gRPC monitoring service
  try {
    await ensureConnection()
    const rq = new monPb.QueryRequest()
    rq.setConnectionid(DEFAULT_CONN_ID)
    rq.setQuery(query)

    const rsp = await unary<monPb.QueryRequest, monPb.QueryResponse>(
      client, 'query', rq, undefined, metadata(),
    )
    const raw = rsp.getValue()
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (parsed.data) return parsed.data
    if (parsed.resultType) return parsed
    if (Array.isArray(parsed)) return { resultType: 'vector', result: parsed }
    return null
  } catch {
    return null
  }
}

// ─── Range query ────────────────────────────────────────────────────────────

/** A single series from a Prometheus range query (matrix result). */
export interface PromRangeSeries {
  metric: Record<string, string>
  values: [number, string][]  // [unixTimestamp, stringValue][]
}

export interface PromRangeResponse {
  resultType: string   // "matrix"
  result: PromRangeSeries[]
}

/**
 * Execute a PromQL range query via the streaming QueryRange gRPC method.
 * startSec/endSec are Unix epoch seconds; stepMs is the step in milliseconds.
 * Returns null if the service is unreachable or the query fails.
 */
export async function queryPrometheusRange(
  query: string,
  startSec: number,
  endSec: number,
  stepMs: number,
): Promise<PromRangeResponse | null> {
  try {
    await ensureConnection()
    const rq = new monPb.QueryRangeRequest()
    rq.setConnectionid(DEFAULT_CONN_ID)
    rq.setQuery(query)
    rq.setStarttime(startSec)
    rq.setEndtime(endSec)
    rq.setStep(stepMs)

    // Collect chunked streaming response
    const chunks: string[] = []
    const factory = (addr: string) => new monGrpc.MonitoringServiceClient(addr, null, { withCredentials: false })
    await stream<monPb.QueryRangeRequest, monPb.QueryRangeResponse>(
      factory, 'queryRange', rq,
      (msg) => { const v = msg.getValue(); if (v) chunks.push(v) },
      'monitoring.MonitoringService',
    )

    const raw = chunks.join('')
    if (!raw) return null

    const parsed = JSON.parse(raw)
    // Prometheus API may wrap in { status, data: { resultType, result } }
    if (parsed.data) return parsed.data
    if (parsed.resultType) return parsed
    // The Go service marshals model.Value directly — may be an array
    if (Array.isArray(parsed)) return { resultType: 'matrix', result: parsed }
    return null
  } catch {
    return null
  }
}

/** Helper: extract [timestamps[], values[]] from the first series of a range result. */
export function rangeToSeries(res: PromRangeResponse | null): [number[], number[]] | null {
  if (!res?.result?.length) return null
  const s = res.result[0]
  const ts: number[] = []
  const vals: number[] = []
  for (const [t, v] of s.values) {
    ts.push(t)
    vals.push(parseFloat(v) || 0)
  }
  return ts.length > 1 ? [ts, vals] : null
}

// ─── Overview history (Prometheus range queries for charts) ─────────────────

export interface OverviewHistory {
  cpu: [number[], number[]] | null
  memory: [number[], number[]] | null
  networkRx: [number[], number[]] | null
  networkTx: [number[], number[]] | null
  disk: [number[], number[]] | null
}

/**
 * Fetch historical time-series for the overview charts via Prometheus range queries.
 * rangeSec: how far back to look (e.g. 300 = 5m, 900 = 15m, 3600 = 1h).
 * instance: optional hostname to filter to a single node (regex-matched with .*).
 * Returns null for each metric that isn't available.
 */
export async function fetchOverviewHistory(rangeSec: number, instance?: string): Promise<OverviewHistory> {
  const now = Math.floor(Date.now() / 1000)
  const start = now - rangeSec
  // Choose step: aim for ~60-120 data points
  const stepMs = Math.max(Math.floor((rangeSec / 100) * 1000), 5000)

  const inst = instance ? `instance=~"${instance}.*"` : ''
  const queries = {
    cpu: `100 - (avg(rate(node_cpu_seconds_total{mode="idle"${inst ? ', ' + inst : ''}}[1m])) * 100)`,
    memory: inst
      ? `(1 - node_memory_MemAvailable_bytes{${inst}} / node_memory_MemTotal_bytes{${inst}}) * 100`
      : '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100',
    networkRx: `sum(rate(node_network_receive_bytes_total{device!="lo"${inst ? ', ' + inst : ''}}[1m]))`,
    networkTx: `sum(rate(node_network_transmit_bytes_total{device!="lo"${inst ? ', ' + inst : ''}}[1m]))`,
    disk: inst
      ? `(1 - node_filesystem_avail_bytes{mountpoint="/", ${inst}} / node_filesystem_size_bytes{mountpoint="/", ${inst}}) * 100`
      : '(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100',
  }

  const [cpuRes, memRes, rxRes, txRes, diskRes] = await Promise.allSettled([
    queryPrometheusRange(queries.cpu, start, now, stepMs),
    queryPrometheusRange(queries.memory, start, now, stepMs),
    queryPrometheusRange(queries.networkRx, start, now, stepMs),
    queryPrometheusRange(queries.networkTx, start, now, stepMs),
    queryPrometheusRange(queries.disk, start, now, stepMs),
  ])

  return {
    cpu: cpuRes.status === 'fulfilled' ? rangeToSeries(cpuRes.value) : null,
    memory: memRes.status === 'fulfilled' ? rangeToSeries(memRes.value) : null,
    networkRx: rxRes.status === 'fulfilled' ? rangeToSeries(rxRes.value) : null,
    networkTx: txRes.status === 'fulfilled' ? rangeToSeries(txRes.value) : null,
    disk: diskRes.status === 'fulfilled' ? rangeToSeries(diskRes.value) : null,
  }
}

// ─── Gateway history (Prometheus range queries for gateway runtime charts) ───

export interface GatewayHistory {
  goroutines: [number[], number[]] | null
  heap: [number[], number[]] | null
  gcPause: [number[], number[]] | null
  gcCycles: [number[], number[]] | null
}

/**
 * Fetch historical time-series for gateway runtime charts via Prometheus range queries.
 * Job label "gateway" matches writePromTargetFile("gateway", ...) in gateway main.go.
 */
export async function fetchGatewayHistory(rangeSec: number): Promise<GatewayHistory> {
  const now = Math.floor(Date.now() / 1000)
  const start = now - rangeSec
  const stepMs = Math.max(Math.floor((rangeSec / 100) * 1000), 5000)

  const queries = {
    goroutines: 'go_goroutines{job="gateway"}',
    heap: 'go_memstats_heap_alloc_bytes{job="gateway"}',
    gcPause: 'rate(go_gc_duration_seconds_sum{job="gateway"}[5m]) / rate(go_gc_duration_seconds_count{job="gateway"}[5m])',
    gcCycles: 'go_gc_duration_seconds_count{job="gateway"}',
  }

  const [grRes, heapRes, gcPRes, gcCRes] = await Promise.allSettled([
    queryPrometheusRange(queries.goroutines, start, now, stepMs),
    queryPrometheusRange(queries.heap, start, now, stepMs),
    queryPrometheusRange(queries.gcPause, start, now, stepMs),
    queryPrometheusRange(queries.gcCycles, start, now, stepMs),
  ])

  return {
    goroutines: grRes.status === 'fulfilled' ? rangeToSeries(grRes.value) : null,
    heap: heapRes.status === 'fulfilled' ? rangeToSeries(heapRes.value) : null,
    gcPause: gcPRes.status === 'fulfilled' ? rangeToSeries(gcPRes.value) : null,
    gcCycles: gcCRes.status === 'fulfilled' ? rangeToSeries(gcCRes.value) : null,
  }
}

// ─── Envoy history (Prometheus range queries for Envoy charts) ──────────────

export interface EnvoyHistory {
  rps: [number[], number[]] | null
  errors5xx: [number[], number[]] | null
  activeConns: [number[], number[]] | null
  p95Latency: [number[], number[]] | null
}

/**
 * Fetch historical time-series for Envoy charts via Prometheus range queries.
 * Job "envoy", scraped at :9901.
 */
export async function fetchEnvoyHistory(rangeSec: number): Promise<EnvoyHistory> {
  const now = Math.floor(Date.now() / 1000)
  const start = now - rangeSec
  const stepMs = Math.max(Math.floor((rangeSec / 100) * 1000), 5000)

  const queries = {
    rps: 'sum(rate(envoy_http_downstream_rq_total[1m]))',
    errors5xx: 'sum(rate(envoy_http_downstream_rq_xx{envoy_response_code_class="5"}[1m]))',
    activeConns: 'envoy_server_total_connections',
    p95Latency: 'histogram_quantile(0.95, sum by (le)(rate(envoy_http_downstream_rq_time_bucket{envoy_http_conn_manager_prefix="http"}[5m])))',
  }

  const [rpsRes, errRes, connRes, p95Res] = await Promise.allSettled([
    queryPrometheusRange(queries.rps, start, now, stepMs),
    queryPrometheusRange(queries.errors5xx, start, now, stepMs),
    queryPrometheusRange(queries.activeConns, start, now, stepMs),
    queryPrometheusRange(queries.p95Latency, start, now, stepMs),
  ])

  return {
    rps: rpsRes.status === 'fulfilled' ? rangeToSeries(rpsRes.value) : null,
    errors5xx: errRes.status === 'fulfilled' ? rangeToSeries(errRes.value) : null,
    activeConns: connRes.status === 'fulfilled' ? rangeToSeries(connRes.value) : null,
    p95Latency: p95Res.status === 'fulfilled' ? rangeToSeries(p95Res.value) : null,
  }
}

// ─── Per-service process metrics ─────────────────────────────────────────────

export interface ServiceProcessMetrics {
  name: string
  cpuPct: number       // % (already multiplied by 100)
  memoryBytes: number
  uptimeSec: number
}

/**
 * Fetch CPU%, memory, and uptime for all services that expose Go process metrics.
 * Returns a Map keyed by lowercase service base name (e.g. "event", "media").
 *
 * PromQL queries:
 *   rate(process_cpu_seconds_total[1m]) * 100   → CPU %
 *   process_resident_memory_bytes               → RSS bytes
 *   process_start_time_seconds                  → epoch seconds
 */
export async function fetchServiceProcessMetrics(): Promise<Map<string, ServiceProcessMetrics>> {
  const result = new Map<string, ServiceProcessMetrics>()

  const [cpuRes, memRes, startRes] = await Promise.allSettled([
    queryPrometheus('rate(process_cpu_seconds_total[1m]) * 100'),
    queryPrometheus('process_resident_memory_bytes'),
    queryPrometheus('process_start_time_seconds'),
  ])

  const cpuMap = new Map<string, number>()
  const memMap = new Map<string, number>()
  const startMap = new Map<string, number>()

  if (cpuRes.status === 'fulfilled' && cpuRes.value?.result) {
    for (const r of cpuRes.value.result) {
      const key = extractServiceKey(r.metric)
      if (key) cpuMap.set(key, parseFloat(r.value[1]) || 0)
    }
  }
  if (memRes.status === 'fulfilled' && memRes.value?.result) {
    for (const r of memRes.value.result) {
      const key = extractServiceKey(r.metric)
      if (key) memMap.set(key, parseFloat(r.value[1]) || 0)
    }
  }
  if (startRes.status === 'fulfilled' && startRes.value?.result) {
    for (const r of startRes.value.result) {
      const key = extractServiceKey(r.metric)
      if (key) startMap.set(key, parseFloat(r.value[1]) || 0)
    }
  }

  const now = Date.now() / 1000
  const allKeys = new Set([...cpuMap.keys(), ...memMap.keys(), ...startMap.keys()])

  for (const key of allKeys) {
    const start = startMap.get(key) ?? 0
    result.set(key, {
      name: key,
      cpuPct: cpuMap.get(key) ?? 0,
      memoryBytes: memMap.get(key) ?? 0,
      uptimeSec: start > 0 ? now - start : 0,
    })
  }

  return result
}

/**
 * Extract a normalized service key from Prometheus metric labels.
 * Tries: job → service_name → instance (host part).
 * Returns lowercase base name (e.g. "event", "media", "gateway").
 */
function extractServiceKey(labels: Record<string, string>): string | null {
  const raw = labels.job || labels.service_name || labels.service || ''
  if (!raw) return null
  // "event.EventService" → "event"
  // "media_server" → "media"
  const base = raw.split('.')[0].replace(/_server$/, '').replace(/\.service$/, '').toLowerCase()
  return base || null
}

// ─── Scrape health (item #8) ─────────────────────────────────────────────────

export interface PrometheusScrapeHealth {
  connected: boolean
  lastScrapeAgo: number | null  // seconds since last scrape
  activeTargets: number
  downTargets: number
  downJobs: string[]  // job names of targets that are down
}

/**
 * Check Prometheus scrape health by querying the targets API.
 */
export async function getPrometheusScrapeHealth(): Promise<PrometheusScrapeHealth> {
  try {
    await ensureConnection()
    const rq = new monPb.TargetsRequest()
    rq.setConnectionid(DEFAULT_CONN_ID)

    const rsp = await unary<monPb.TargetsRequest, monPb.TargetsResponse>(
      client, 'targets', rq, undefined, metadata(),
    )
    const raw = rsp.getResult()
    if (!raw) return { connected: true, lastScrapeAgo: null, activeTargets: 0, downTargets: 0, downJobs: [] }

    const data = JSON.parse(raw)
    // Response may be { activeTargets: [...], droppedTargets: [...] }
    // or wrapped in { data: { activeTargets: [...] } }
    const targets = data.activeTargets || data.data?.activeTargets || []

    let latestScrape = 0
    let downCount = 0
    const downJobs: string[] = []
    for (const t of targets) {
      if (t.health === 'down') {
        downCount++
        const job = t.labels?.job ?? t.scrapePool ?? ''
        if (job && !downJobs.includes(job)) downJobs.push(job)
      }
      const last = new Date(t.lastScrape).getTime()
      if (!isNaN(last) && last > latestScrape) latestScrape = last
    }

    return {
      connected: true,
      lastScrapeAgo: latestScrape > 0 ? Math.floor((Date.now() - latestScrape) / 1000) : null,
      activeTargets: targets.length,
      downTargets: downCount,
      downJobs,
    }
  } catch {
    return { connected: false, lastScrapeAgo: null, activeTargets: 0, downTargets: 0, downJobs: [] }
  }
}
