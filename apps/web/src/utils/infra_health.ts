// apps/web/src/utils/infra_health.ts
//
// Shared health model for all Infrastructure pages.

import type {
  ClusterHealth, ClusterHealthV1Result,
  StorageResponse, EnvoyResponse,
  PrometheusScrapeHealth, ClusterReport,
  ServiceInstance,
} from '@globular/backend'

// ─── Health state types ─────────────────────────────────────────────────────

export type HealthState = 'healthy' | 'degraded' | 'critical' | 'unknown'

export interface HealthStatus {
  state: HealthState
  reason?: string
  lastUpdated?: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function deriveStatus(ok: boolean, reason?: string): HealthStatus {
  return { state: ok ? 'healthy' : 'critical', reason, lastUpdated: Date.now() }
}

/** Merge multiple statuses — worst state wins. */
export function mergeStatuses(...statuses: HealthStatus[]): HealthStatus {
  const order: Record<HealthState, number> = { healthy: 0, degraded: 1, critical: 2, unknown: 3 }
  let worst: HealthStatus = { state: 'healthy', lastUpdated: Date.now() }
  for (const s of statuses) {
    if ((order[s.state] ?? 0) > (order[worst.state] ?? 0)) worst = s
  }
  return worst
}

export function humanReason(s: HealthStatus): string {
  return s.reason ?? (s.state === 'healthy' ? 'All systems operational' : s.state)
}

export function isFresh(lastUpdated: number, maxAgeMs: number): boolean {
  return Date.now() - lastUpdated < maxAgeMs
}

export function stateColor(s: HealthState): string {
  switch (s) {
    case 'healthy':  return '#22c55e'
    case 'degraded': return '#f59e0b'
    case 'critical': return 'var(--error-color)'
    default:         return 'var(--secondary-text-color)'
  }
}

export function stateLabel(s: HealthState): string {
  return s.toUpperCase()
}

export function badge(label: string, color: string): string {
  return `<span class="md-badge" style="--badge-color:${color}">${label}</span>`
}

export function stateBadge(s: HealthState): string {
  return badge(stateLabel(s), stateColor(s))
}

export function esc(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

export function fmtBytes(b: number): string {
  if (b <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1)
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtDuration(sec: number): string {
  if (sec < 0) sec = 0
  if (sec < 60) return `${Math.floor(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

export function fmtPct(v: number): string {
  return `${v.toFixed(1)}%`
}

export function fmtRate(v: number): string {
  if (v < 1) return v.toFixed(2)
  if (v < 100) return v.toFixed(1)
  return Math.round(v).toLocaleString()
}

export function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function freshnessBadge(lastUpdated: number | null, pollInterval: number): string {
  if (!lastUpdated) return badge('UNKNOWN', 'var(--secondary-text-color)')
  const age = Date.now() - lastUpdated
  if (age > pollInterval * 3) return badge('DISCONNECTED', 'var(--error-color)')
  if (age > pollInterval * 2) return badge('STALE', '#f59e0b')
  return badge('LIVE', '#22c55e')
}

export function externalHost(): string {
  return window.location.hostname
}

// ─── Top Issues correlation ─────────────────────────────────────────────────

export interface InfraIssue {
  severity: 'critical' | 'degraded'
  title: string
  detail?: string
  route: string
  source?: string
}

export interface IssueInputs {
  clusterHealth?: ClusterHealth | null
  clusterHealthV1?: ClusterHealthV1Result | null
  storage?: StorageResponse | null
  envoy?: EnvoyResponse | null
  prometheus?: PrometheusScrapeHealth | null
  clusterReport?: ClusterReport | null
  services?: ServiceInstance[] | null
}

export function collectInfraIssues(inputs: IssueInputs): InfraIssue[] {
  const issues: InfraIssue[] = []

  // Envoy
  if (inputs.envoy) {
    const unhealthy = inputs.envoy.clusters.filter(c => c.unhealthy > 0)
    if (unhealthy.length > 0) {
      issues.push({
        severity: 'critical',
        title: `Envoy: ${unhealthy.length} cluster(s) with unhealthy hosts`,
        route: '#/infrastructure/networking',
        source: 'envoy',
      })
    }
    if (inputs.envoy.downstream.days_until_cert_expiry > 0 &&
        inputs.envoy.downstream.days_until_cert_expiry < 7) {
      issues.push({
        severity: 'degraded',
        title: `TLS cert expires in ${Math.floor(inputs.envoy.downstream.days_until_cert_expiry)} days`,
        route: '#/infrastructure/networking',
        source: 'envoy',
      })
    }
  }

  // Prometheus
  if (inputs.prometheus) {
    if (!inputs.prometheus.connected) {
      issues.push({
        severity: 'critical',
        title: 'Prometheus disconnected',
        route: '#/infrastructure/observability',
        source: 'prometheus',
      })
    } else if (inputs.prometheus.downTargets > 0) {
      const downJobs = inputs.prometheus.downJobs ?? []
      // Surface MinIO specifically — likely missing bearer_token_file
      if (downJobs.includes('minio')) {
        issues.push({
          severity: 'degraded',
          title: 'MinIO metrics target down — bearer token file may be missing',
          detail: 'Run provision-minio-token.sh to generate the token',
          route: '#/infrastructure/observability',
          source: 'prometheus',
        })
      }
      // Surface ScyllaDB specifically — likely wrong target IP
      if (downJobs.includes('scylla')) {
        issues.push({
          severity: 'degraded',
          title: 'ScyllaDB metrics target down — check target IP matches listen_address',
          route: '#/infrastructure/observability',
          source: 'prometheus',
        })
      }
      // Surface sidekick specifically
      if (downJobs.includes('sidekick')) {
        issues.push({
          severity: 'degraded',
          title: 'Sidekick proxy metrics target down — check sidekick is running on port 8081',
          route: '#/infrastructure/storage',
          source: 'prometheus',
        })
      }
      // General down-targets issue (excluding already-surfaced jobs)
      const specificJobs = ['minio', 'scylla', 'sidekick']
      const otherDown = inputs.prometheus.downTargets - downJobs.filter(j => specificJobs.includes(j)).length
      if (otherDown > 0) {
        issues.push({
          severity: 'degraded',
          title: `Prometheus: ${otherDown} target(s) down`,
          route: '#/infrastructure/observability',
          source: 'prometheus',
        })
      }
    }
  }

  // Control Plane
  if (inputs.clusterHealth) {
    if (inputs.clusterHealth.status && inputs.clusterHealth.status.toUpperCase() !== 'HEALTHY') {
      issues.push({
        severity: 'degraded',
        title: `Cluster status: ${inputs.clusterHealth.status}`,
        route: '#/infrastructure/control-plane',
        source: 'cluster',
      })
    }
  }
  if (inputs.clusterHealthV1?.nodeHealths) {
    const mismatched = inputs.clusterHealthV1.nodeHealths.filter(n =>
      n.desiredServicesHash && n.appliedServicesHash &&
      n.desiredServicesHash !== n.appliedServicesHash
    )
    if (mismatched.length > 0) {
      issues.push({
        severity: 'degraded',
        title: `${mismatched.length} node(s) with hash mismatch`,
        route: '#/infrastructure/control-plane',
        source: 'cluster',
      })
    }
  }

  // Storage
  if (inputs.storage) {
    const broken = inputs.storage.applications.filter(a => !a.exists || !a.writable)
    if (broken.length > 0) {
      issues.push({
        severity: 'critical',
        title: `Storage: ${broken.length} app path(s) unavailable/read-only`,
        detail: broken.map(a => a.name).join(', '),
        route: '#/infrastructure/storage',
        source: 'storage',
      })
    }
    const lowMounts = inputs.storage.mounts.filter(m => m.free_pct < 10)
    if (lowMounts.length > 0) {
      issues.push({
        severity: 'degraded',
        title: `Storage: ${lowMounts.length} mount(s) below 10% free`,
        route: '#/infrastructure/storage',
        source: 'storage',
      })
    }
  }

  // DNS
  if (inputs.services) {
    const dns = inputs.services.find(s => s.name.toLowerCase().includes('dns'))
    if (dns && dns.state !== 'running') {
      issues.push({
        severity: 'degraded',
        title: 'DNS service not running',
        route: '#/infrastructure/dns',
        source: 'dns',
      })
    }
  }

  // Diagnostics
  if (inputs.clusterReport) {
    const critFindings = inputs.clusterReport.findings.filter(f => f.severity >= 4)
    if (critFindings.length > 0) {
      issues.push({
        severity: 'critical',
        title: `Cluster Doctor: ${critFindings.length} critical finding(s)`,
        route: '#/admin/diagnostics',
        source: 'diagnostics',
      })
    }
  }

  // Sort: critical first
  issues.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))
  return issues
}

// ─── Issue route labels ─────────────────────────────────────────────────────

const ROUTE_LABELS: Record<string, string> = {
  '#/infrastructure/networking':    'Open Networking',
  '#/infrastructure/storage':       'Open Storage',
  '#/infrastructure/control-plane': 'Open Control Plane',
  '#/infrastructure/observability': 'Open Observability',
  '#/infrastructure/dns':           'Open DNS',
  '#/admin/diagnostics':            'Open Diagnostics',
}

export function issueRouteLabel(route: string): string {
  return ROUTE_LABELS[route] ?? 'Go'
}

// ─── Shared CSS styles for infrastructure pages ─────────────────────────────

export const INFRA_STYLES = `
  .infra-header {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .infra-header h2 { margin: 0; }
  .infra-header .spacer { flex: 1; }
  .infra-timestamp {
    font: var(--md-typescale-label-small);
    color: var(--secondary-text-color);
  }
  .infra-btn {
    border: 1px solid var(--border-subtle-color);
    background: transparent; color: var(--on-surface-color);
    border-radius: var(--md-shape-sm);
    padding: 3px 10px; cursor: pointer; font-size: .78rem;
  }
  .infra-btn:hover { background: var(--md-state-hover); }
  .infra-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px; margin-bottom: 16px;
  }
  .infra-card {
    background: var(--md-surface-container-low);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-md);
    box-shadow: var(--md-elevation-1);
    padding: 14px 18px;
  }
  .infra-card-clickable {
    cursor: pointer; transition: background .15s;
  }
  .infra-card-clickable:hover {
    background: var(--md-state-hover);
  }
  .infra-card-label {
    font-size: .72rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
    color: var(--secondary-text-color); margin-bottom: 4px;
  }
  .infra-card-value {
    font-size: 1.8rem; font-weight: 800; line-height: 1; margin-bottom: 2px;
  }
  .infra-card-sub {
    font-size: .75rem; color: var(--secondary-text-color); margin-top: 2px;
  }
  .infra-card-metric {
    font-size: .85rem; line-height: 1.6;
  }
  .infra-table {
    width: 100%; border-collapse: collapse; font-size: .85rem;
  }
  .infra-table th, .infra-table td {
    padding: 6px 10px; text-align: left;
  }
  .infra-table th {
    font-size: .72rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--secondary-text-color);
    border-bottom: 1px solid var(--border-subtle-color);
  }
  .infra-table td {
    border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent);
  }
  .infra-section-title {
    font-size: .78rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: .06em; color: var(--secondary-text-color);
    margin: 16px 0 8px;
  }
  .infra-empty {
    padding: 14px; font-size: .85rem; font-style: italic;
    color: var(--secondary-text-color);
  }
  .infra-link {
    color: var(--accent-color); text-decoration: none; font-size: .82rem;
    cursor: pointer;
  }
  .infra-link:hover { text-decoration: underline; }
  .infra-quick-links {
    display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px;
  }
  .infra-progress-bar {
    height: 6px; border-radius: 3px;
    background: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
    overflow: hidden;
  }
  .infra-progress-fill {
    height: 100%; border-radius: 3px; transition: width .3s;
  }
  .infra-issue-row {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent);
    font-size: .85rem;
  }
  .infra-issue-row:last-child { border-bottom: none; }
  .infra-banner-ok {
    padding: 10px 14px; font-size: .85rem;
    color: #22c55e;
  }
  .infra-tabs {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border-subtle-color);
    margin-bottom: 12px;
  }
  .infra-tab {
    padding: 8px 16px; border: none; background: transparent;
    color: var(--secondary-text-color); cursor: pointer;
    font: var(--md-typescale-label-large);
    border-bottom: 2px solid transparent; transition: all .15s;
  }
  .infra-tab:hover { color: var(--on-surface-color); background: var(--md-state-hover); }
  .infra-tab.active { color: var(--accent-color); border-bottom-color: var(--accent-color); }
`
