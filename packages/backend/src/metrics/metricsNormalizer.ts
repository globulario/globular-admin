// packages/backend/src/metrics/metricsNormalizer.ts
//
// Pure-logic module: converts raw stats + cluster data into a normalized
// view-model that the UI renders without computing health rules itself.

import type { GatewayStats } from './stats'
import type { ClusterHealth } from '../cluster/cluster'
import type { StatsRingBuffer } from './stats'

// ─── Severity / Color ───────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'ok'

export const COLOR = {
  healthy:  '#22c55e',
  warning:  '#f59e0b',
  critical: '#ef4444',
  cpu:      '#6366f1',
  memory:   '#ec4899',
  disk:     '#f97316',
  network:  '#14b8a6',
  gateway:  '#a855f7',
  info:     '#6366f1',
} as const

export function severityColor(s: Severity): string {
  if (s === 'critical') return COLOR.critical
  if (s === 'warning') return COLOR.warning
  return COLOR.healthy
}

// ─── Thresholds ─────────────────────────────────────────────────────────────

export const THRESHOLDS = {
  cpu:        { warn: 70, crit: 85 },
  memory:     { warn: 70, crit: 85 },
  diskFree:   { warn: 15, crit: 10 },
  diskUsed:   { warn: 70, high: 85, crit: 90 },
} as const

export function pctSeverity(value: number, warnAt: number, critAt: number): Severity {
  if (value >= critAt) return 'critical'
  if (value >= warnAt) return 'warning'
  return 'ok'
}

export function pctColor(value: number, warnAt: number, critAt: number): string {
  return severityColor(pctSeverity(value, warnAt, critAt))
}

export function diskUsedSeverity(usedPct: number): Severity {
  if (usedPct > THRESHOLDS.diskUsed.crit) return 'critical'
  if (usedPct > THRESHOLDS.diskUsed.high) return 'warning'
  return 'ok'
}

export function diskUsedColor(usedPct: number): string {
  const s = diskUsedSeverity(usedPct)
  if (s === 'critical') return COLOR.critical
  if (s === 'warning') return COLOR.warning
  if (usedPct > THRESHOLDS.diskUsed.warn) return COLOR.disk
  return COLOR.healthy
}

export function diskFreeColor(freePct: number): string {
  if (freePct < THRESHOLDS.diskFree.crit) return COLOR.critical
  if (freePct < THRESHOLDS.diskFree.warn) return COLOR.warning
  return COLOR.disk
}

// ─── Health breakdown ───────────────────────────────────────────────────────

export interface HealthCheck {
  severity: Severity
  message: string
  subsystem: string
}

export interface ClusterHealthModel {
  overall: Severity
  label: string
  checks: HealthCheck[]
}

export function computeClusterHealth(
  health: ClusterHealth | null,
  stats: GatewayStats | null,
): ClusterHealthModel {
  const checks: HealthCheck[] = []

  if (!health) {
    checks.push({ severity: 'critical', message: 'Cluster health unavailable', subsystem: 'cluster' })
    return { overall: 'critical', label: 'Unhealthy', checks }
  }

  if (health.status.toUpperCase() === 'UNHEALTHY') {
    checks.push({ severity: 'critical', message: 'Cluster reports UNHEALTHY', subsystem: 'cluster' })
  }

  if (!stats) {
    checks.push({ severity: 'critical', message: 'Stats endpoint unreachable', subsystem: 'gateway' })
  } else {
    // CPU
    if (stats.cpu.usagePct > THRESHOLDS.cpu.crit) {
      checks.push({ severity: 'critical', message: `CPU usage ${fmt1(stats.cpu.usagePct)}% on gateway`, subsystem: 'cpu' })
    } else if (stats.cpu.usagePct > THRESHOLDS.cpu.warn) {
      checks.push({ severity: 'warning', message: `CPU usage ${fmt1(stats.cpu.usagePct)}% on gateway`, subsystem: 'cpu' })
    } else {
      checks.push({ severity: 'ok', message: `CPU usage ${fmt1(stats.cpu.usagePct)}%`, subsystem: 'cpu' })
    }

    // Memory
    if (stats.memory.usedPct > THRESHOLDS.memory.crit) {
      checks.push({ severity: 'critical', message: `Memory usage ${fmt1(stats.memory.usedPct)}% on gateway`, subsystem: 'memory' })
    } else if (stats.memory.usedPct > THRESHOLDS.memory.warn) {
      checks.push({ severity: 'warning', message: `Memory usage ${fmt1(stats.memory.usedPct)}% on gateway`, subsystem: 'memory' })
    } else {
      checks.push({ severity: 'ok', message: `Memory usage ${fmt1(stats.memory.usedPct)}%`, subsystem: 'memory' })
    }

    // Disk
    if (stats.disk.freePct < THRESHOLDS.diskFree.crit) {
      checks.push({ severity: 'critical', message: `Disk free only ${fmt1(stats.disk.freePct)}% on ${stats.hostname || 'gateway'}`, subsystem: 'disk' })
    } else if (stats.disk.freePct < THRESHOLDS.diskFree.warn) {
      checks.push({ severity: 'warning', message: `Disk free ${fmt1(stats.disk.freePct)}% on ${stats.hostname || 'gateway'}`, subsystem: 'disk' })
    } else {
      checks.push({ severity: 'ok', message: `Disk free ${fmt1(stats.disk.freePct)}%`, subsystem: 'disk' })
    }
  }

  // Per-node checks
  for (const n of health.nodes) {
    const s = n.status.toUpperCase()
    if (s === 'UNHEALTHY' || s === 'UNREACHABLE') {
      checks.push({ severity: 'critical', message: `Node ${n.hostname || n.nodeId} is ${n.status}`, subsystem: 'node' })
    } else if (s === 'DEGRADED') {
      checks.push({ severity: 'warning', message: `Node ${n.hostname || n.nodeId} is DEGRADED`, subsystem: 'node' })
    } else if (s === 'CONVERGING') {
      checks.push({ severity: 'warning', message: `Node ${n.hostname || n.nodeId} is reconciling desired state`, subsystem: 'node' })
    } else {
      checks.push({ severity: 'ok', message: `Node ${n.hostname || n.nodeId} is ${n.status}`, subsystem: 'node' })
    }
  }

  // If no problems found, add an all-clear
  if (checks.every(c => c.severity === 'ok')) {
    // already has ok checks
  }

  const overall: Severity = checks.some(c => c.severity === 'critical')
    ? 'critical'
    : checks.some(c => c.severity === 'warning')
    ? 'warning'
    : 'ok'

  const label = overall === 'critical' ? 'Unhealthy' : overall === 'warning' ? 'Degraded' : 'Healthy'

  return { overall, label, checks }
}

// ─── Storage health ─────────────────────────────────────────────────────────

export interface StorageHealthModel {
  overall: Severity
  label: string
  objectStore: 'ok' | 'at_risk' | 'down' | 'unknown'
  objectStoreNote: string
  reason: string
}

export function computeStorageHealth(
  stats: GatewayStats | null,
  objectStoreOk: boolean | null,
): StorageHealthModel {
  let overall: Severity = 'ok'
  let label = 'HEALTHY'
  let objectStore: StorageHealthModel['objectStore'] = 'unknown'
  let objectStoreNote = ''
  let reason = ''

  // Disk checks
  if (stats) {
    if (stats.disk.freePct < THRESHOLDS.diskFree.crit) {
      overall = 'critical'
      label = 'CRITICAL'
      reason = `Disk free ${fmt1(stats.disk.freePct)}% (< ${THRESHOLDS.diskFree.crit}%)`
    } else if (stats.disk.freePct < THRESHOLDS.diskFree.warn) {
      overall = 'warning'
      label = 'WARNING'
      reason = `Disk free ${fmt1(stats.disk.freePct)}% (< ${THRESHOLDS.diskFree.warn}%)`
    }
  }

  // Object store
  if (objectStoreOk === true) {
    if (overall === 'critical') {
      objectStore = 'at_risk'
      objectStoreNote = 'Object store operational but disk capacity critical'
    } else {
      objectStore = 'ok'
    }
  } else if (objectStoreOk === false) {
    objectStore = 'down'
    overall = 'critical'
    label = 'CRITICAL'
    reason = reason ? reason + ' + object store down' : 'Object store unreachable'
  }

  return { overall, label, objectStore, objectStoreNote, reason }
}

// ─── Trend computation ──────────────────────────────────────────────────────

export interface TrendInfo {
  direction: 'up' | 'down' | 'stable'
  delta: number
  label: string // e.g. "(↑ 5.0% last 5m)"
}

export function computeTrend(
  ring: StatsRingBuffer,
  extractor: (s: GatewayStats) => number,
): TrendInfo {
  const arr = ring.toArray()
  if (arr.length < 2) return { direction: 'stable', delta: 0, label: '' }
  const now = extractor(arr[arr.length - 1].stats)
  const lookback = Math.min(12, arr.length - 1) // ~60s at 5s interval
  const then = extractor(arr[arr.length - 1 - lookback].stats)
  const diff = now - then
  if (Math.abs(diff) < 0.5) return { direction: 'stable', delta: 0, label: 'stable' }
  const dir = diff > 0 ? 'up' : 'down'
  const arrow = diff > 0 ? '\u2191' : '\u2193'  // ↑ ↓
  const window = lookback * 5 // seconds
  const windowLabel = window >= 60 ? `${Math.round(window / 60)}m` : `${window}s`
  return {
    direction: dir,
    delta: Math.abs(diff),
    label: `(${arrow} ${Math.abs(diff).toFixed(1)}% last ${windowLabel})`,
  }
}

// ─── GC percentiles ─────────────────────────────────────────────────────────

export interface GCPercentiles {
  p50: number
  p95: number
  count: number
}

export function computeGCPercentiles(ring: StatsRingBuffer): GCPercentiles {
  const arr = ring.toArray()
  const pauses = arr.map(s => s.stats.go.gcPauseNs).filter(v => v > 0).sort((a, b) => a - b)
  if (pauses.length === 0) return { p50: 0, p95: 0, count: 0 }
  const p50 = pauses[Math.floor(pauses.length * 0.5)]
  const p95 = pauses[Math.floor(pauses.length * 0.95)]
  const last = arr[arr.length - 1]
  return { p50, p95, count: last?.stats.go.numGC ?? 0 }
}

// ─── Service health (item #4) ───────────────────────────────────────────────

export interface ServiceHealthModel {
  name: string
  displayName: string
  state: string
  version: string
  severity: Severity
  category: 'Core' | 'Infrastructure' | 'Media' | 'Other'
}

const CORE = new Set(['gateway', 'discovery', 'repository', 'resource', 'rbac', 'authentication', 'event', 'log', 'file'])
const INFRA = new Set(['etcd', 'envoy', 'scylla', 'minio', 'prometheus', 'dns'])
const MEDIA = new Set(['media', 'title', 'torrent', 'search'])

export function normalizeServices(svcs: Record<string, any>): ServiceHealthModel[] {
  const result: ServiceHealthModel[] = []
  for (const [name, cfg] of Object.entries(svcs)) {
    const c = cfg as any
    const base = (c.Name ?? name).replace(/\.service$/, '').split('.')[0].toLowerCase()
    const state = (c.State ?? 'unknown').toLowerCase()

    let severity: Severity = 'ok'
    if (state === 'failed' || state === 'error' || state === 'dead') severity = 'critical'
    else if (state === 'restarting' || state === 'degraded') severity = 'warning'
    else if (state !== 'running' && state !== 'active') severity = 'warning'

    let category: ServiceHealthModel['category'] = 'Other'
    if (CORE.has(base)) category = 'Core'
    else if (INFRA.has(base)) category = 'Infrastructure'
    else if (MEDIA.has(base)) category = 'Media'

    result.push({
      name,
      displayName: c.Name ?? name,
      state: c.State ?? 'unknown',
      version: c.Version ?? '',
      severity,
      category,
    })
  }
  return result
}

export function groupNormalizedServices(
  services: ServiceHealthModel[],
): Array<{ category: string; services: ServiceHealthModel[] }> {
  const groups: Record<string, ServiceHealthModel[]> = {}
  for (const s of services) {
    if (!groups[s.category]) groups[s.category] = []
    groups[s.category].push(s)
  }
  const order = ['Core', 'Infrastructure', 'Media', 'Other']
  return order
    .filter(cat => groups[cat]?.length)
    .map(cat => ({ category: cat, services: groups[cat] }))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt1(v: number): string {
  return v.toFixed(1)
}
