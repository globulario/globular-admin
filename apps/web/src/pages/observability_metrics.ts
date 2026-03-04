import "@globular/components/markdown.js"
import '@polymer/iron-icons/iron-icons.js'
import '@polymer/paper-icon-button/paper-icon-button.js'
import '@polymer/iron-collapse/iron-collapse.js'
import { navigateTo } from '../router'
import {
  fetchGatewayStats,
  StatsRingBuffer,
  getClusterHealth,
  type ClusterHealth,
  listClusterNodes,
  type ClusterNode,
  getClusterHealthV1Full,
  type ClusterHealthV1Result,
  // Normalizer (item #10)
  computeClusterHealth,
  computeStorageHealth,
  computeTrend,
  computeGCPercentiles,
  normalizeServices,
  groupNormalizedServices,
  type ClusterHealthModel,
  type StorageHealthModel,
  type TrendInfo,
  type ServiceHealthModel,
  COLOR,
  THRESHOLDS,
  pctColor,
  diskUsedColor,
  diskFreeColor,
  severityColor,
  type Severity,
  // Prometheus (items #4, #8)
  fetchServiceProcessMetrics,
  getPrometheusScrapeHealth,
  fetchOverviewHistory,
  fetchGatewayHistory,
  fetchEnvoyHistory,
  type ServiceProcessMetrics,
  type PrometheusScrapeHealth,
  type OverviewHistory,
  type GatewayHistory,
  type EnvoyHistory,
  // Admin metrics (server-side derived)
  fetchAdminServices,
  fetchAdminStorage,
  fetchAdminEnvoy,
  type ServicesResponse,
  type StorageResponse,
  type EnvoyResponse,
  type EnvoyCluster,
  type EnvoyListener,
  type EnvoyXDS,
  type RDSRoute,
  type ServiceGroup,
  type ServiceInstance,
  type MountInfo,
  type GatewayStats,
  type ApplicationPath,
  type InfraDetail,
} from '@globular/backend'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

// ─── Formatters ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtBytes(b: number): string {
  if (b === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1)
  return (b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i]
}

function fmtPct(v: number): string { return v.toFixed(1) + '%' }

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

function fmtNs(ns: number): string {
  if (ns < 1000) return `${ns}ns`
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(1)}us`
  return `${(ns / 1_000_000).toFixed(2)}ms`
}

function fmtMs(ms: number): string {
  if (!ms || !isFinite(ms)) return '--'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}\u00B5s`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function fmtRate(rps: number): string {
  if (!rps || !isFinite(rps)) return '--'
  if (rps < 0.01) return '<0.01/s'
  if (rps < 10) return `${rps.toFixed(2)}/s`
  if (rps < 100) return `${rps.toFixed(1)}/s`
  return `${Math.round(rps)}/s`
}

function fmtCount(n: number): string {
  if (!n || !isFinite(n)) return '--'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K'
  return (n / 1_000_000).toFixed(1) + 'M'
}

// ─── Shared renderers ───────────────────────────────────────────────────────

function badge(label: string, color: string): string {
  return `<span class="om-badge" style="background:color-mix(in srgb,${color} 15%,transparent);color:${color};border-color:color-mix(in srgb,${color} 30%,transparent);">${esc(label)}</span>`
}

function sevBadge(label: string, sev: Severity): string {
  return badge(label, severityColor(sev))
}

function sevDot(sev: Severity): string {
  return `<span style="color:${severityColor(sev)};font-size:10px;">&#x25cf;</span>`
}

function trendHtml(t: TrendInfo): string {
  if (!t.label) return ''
  const color = t.direction === 'up' ? COLOR.warning : t.direction === 'down' ? COLOR.healthy : 'var(--secondary-text-color,#888)'
  return `<span style="color:${color};font-size:.75em;margin-left:4px;">${esc(t.label)}</span>`
}

function miniBar(pct: number, color: string): string {
  return `<div class="om-mini-bar"><div class="om-mini-bar-fill" style="width:${pct}%;background:${color};"></div></div>`
}

// ─── Cross-link helpers ──────────────────────────────────────────────────

function clusterToServiceName(clusterName: string): string | null {
  const m = clusterName.match(/^(.+?)_([A-Z]\w+Service)_cluster$/)
  return m ? `${m[1]}.${m[2]}` : null
}

function serviceToClusterName(svcName: string): string | null {
  const parts = svcName.split('.')
  if (parts.length !== 2) return null
  return `${parts[0]}_${parts[1]}_cluster`
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const STYLES = `
  .om-wrap { padding: 16px; }
  .om-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .om-header h2 { margin: 0; font: var(--md-typescale-headline-small); }
  .om-last-updated { font: var(--md-typescale-label-small); color: var(--secondary-text-color); }
  .om-scrape-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font: var(--md-typescale-label-small); color: var(--secondary-text-color);
    padding: 2px 8px; border-radius: var(--md-shape-full, 100px);
    border: 1px solid var(--border-subtle-color);
    margin-left: 8px;
  }
  .om-scrape-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .om-subtitle { margin: .25rem 0 1rem; opacity: .7; font: var(--md-typescale-body-medium); }

  .om-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border-subtle-color); margin-bottom: 12px; }
  .om-tab {
    padding: 8px 16px; border: none; background: transparent;
    color: var(--secondary-text-color); cursor: pointer;
    font: var(--md-typescale-label-large);
    border-bottom: 2px solid transparent; transition: all .15s;
  }
  .om-tab:hover { color: var(--on-surface-color); background: var(--md-state-hover); }
  .om-tab.active { color: var(--accent-color); border-bottom-color: var(--accent-color); }

  .om-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px; margin-bottom: 16px;
  }
  .om-stat-card {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px);
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .om-stat-label {
    font: var(--md-typescale-label-medium);
    color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .03em;
  }
  .om-stat-value {
    font: var(--md-typescale-headline-small);
    color: var(--on-surface-color);
    display: flex; align-items: center; gap: 6px;
  }
  .om-stat-sub { font: var(--md-typescale-body-small); color: var(--secondary-text-color); margin-top: 2px; }

  /* Charts */
  .om-chart-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 12px; margin-bottom: 16px;
  }
  @media (max-width: 720px) { .om-chart-grid { grid-template-columns: 1fr; } }
  .om-chart-panel {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px); padding: 12px 14px;
  }
  .om-chart-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .om-chart-title { font: var(--md-typescale-label-large); color: var(--secondary-text-color); }
  .om-chart-value { font: var(--md-typescale-title-medium); color: var(--on-surface-color); }
  .om-chart-wrap { width: 100%; overflow: hidden; }

  .om-badge {
    display: inline-block; padding: 2px 10px;
    border-radius: var(--md-shape-full, 100px); border: 1px solid;
    font: var(--md-typescale-label-small); white-space: nowrap;
  }

  /* Health breakdown (item #1) */
  .om-health-section { margin-top: 6px; }
  .om-health-toggle {
    background: none; border: none; padding: 0;
    color: var(--accent-color); cursor: pointer;
    font: var(--md-typescale-label-small); text-decoration: underline;
  }
  .om-health-toggle:hover { opacity: .8; }

  /* Table */
  .om-table { width: 100%; border-collapse: collapse; font: var(--md-typescale-body-medium); }
  .om-table th, .om-table td { padding: 8px 10px; text-align: left; }
  .om-table th { font: var(--md-typescale-label-large); color: var(--secondary-text-color); border-bottom: 1px solid var(--border-subtle-color); }
  .om-table td { border-bottom: 1px solid color-mix(in srgb, var(--border-subtle-color) 40%, transparent); }
  .om-table tr:hover td { background: var(--md-state-hover); }

  /* Node cards (item #3) */
  .om-node-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; margin-bottom: 16px; }
  .om-node-card {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px); padding: 18px 20px;
  }
  .om-node-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .om-node-hostname { font: var(--md-typescale-title-medium); color: var(--on-surface-color); }
  .om-node-resources { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .om-node-res-item { text-align: center; }
  .om-node-res-label { font: var(--md-typescale-label-small); color: var(--secondary-text-color); text-transform: uppercase; letter-spacing: .03em; font-size: 9px; margin-bottom: 4px; }
  .om-node-res-val { font: var(--md-typescale-title-small); color: var(--on-surface-color); }
  .om-node-res-trend { font: var(--md-typescale-label-small); }
  .om-node-specs {
    font: var(--md-typescale-body-small); color: var(--secondary-text-color); text-align: center;
    padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--border-subtle-color) 50%, transparent);
  }
  .om-mini-bar { height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--border-subtle-color) 60%, transparent); overflow: hidden; margin-top: 3px; }
  .om-mini-bar-fill { height: 100%; border-radius: 2px; transition: width .3s; }

  /* Service tiles (item #4) */
  .om-svc-group-title { font: var(--md-typescale-title-small); color: var(--on-surface-color); margin: 16px 0 8px; }
  .om-svc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .om-svc-tile {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px);
    padding: 16px 18px; display: flex; align-items: flex-start; gap: 12px;
    cursor: pointer; transition: background .15s;
    color: var(--on-surface-color); text-decoration: none;
  }
  .om-svc-tile:hover { background: var(--md-state-hover); }
  .om-svc-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
  .om-svc-info { flex: 1; min-width: 0; }
  .om-svc-name { font: var(--md-typescale-title-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .om-svc-meta { font: var(--md-typescale-label-small); color: var(--secondary-text-color); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .om-svc-divider { height: 1px; background: var(--border-subtle-color); margin: 10px 0; opacity: 0.5; }
  .om-svc-stats-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 2px 12px;
  }
  .om-svc-stat-item { display: flex; flex-direction: column; padding: 2px 0; }
  .om-svc-stat-label { font: var(--md-typescale-label-small); color: var(--secondary-text-color); opacity: 0.7; text-transform: uppercase; letter-spacing: .03em; font-size: 9px; }
  .om-svc-stat-val { font: var(--md-typescale-body-small); color: var(--on-surface-color); }
  .om-svc-stats {
    display: flex; gap: 8px; margin-top: 4px;
    font: var(--md-typescale-label-small); color: var(--secondary-text-color);
  }
  .om-svc-stats span { white-space: nowrap; }

  /* Progress bar */
  .om-progress-outer { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--border-subtle-color) 60%, transparent); overflow: hidden; margin-top: 4px; }
  .om-progress-inner { height: 100%; border-radius: 4px; transition: width .3s, background .5s; }

  .om-loading { padding: 32px; text-align: center; color: var(--secondary-text-color); }
  .om-error { padding: 12px; color: var(--error-color, #ef4444); }

  .om-panel {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px); padding: 14px 16px; margin-bottom: 12px;
  }
  .om-panel-title { font: var(--md-typescale-title-small); color: var(--on-surface-color); margin-bottom: 8px; }

  /* Gateway */
  .om-gw-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .om-gw-card {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px); padding: 14px 16px;
  }
  .om-gw-label { font: var(--md-typescale-label-medium); color: var(--secondary-text-color); margin-bottom: 2px; }
  .om-gw-value { font: var(--md-typescale-headline-small); color: var(--on-surface-color); margin-bottom: 6px; }
  .om-gw-spark { height: 40px; }

  /* Per-core bars (item #9) */
  .om-core-wrap { position: relative; }
  .om-core-scale {
    position: absolute; left: 0; top: 0; bottom: 0; width: 30px;
    display: flex; flex-direction: column; justify-content: space-between;
    font: 9px sans-serif; color: var(--secondary-text-color); padding: 2px 0;
  }
  .om-core-area {
    margin-left: 32px; position: relative; height: 80px;
    background:
      repeating-linear-gradient(to bottom,
        transparent, transparent calc(50% - 0.5px),
        color-mix(in srgb, var(--border-subtle-color) 30%, transparent) calc(50% - 0.5px),
        color-mix(in srgb, var(--border-subtle-color) 30%, transparent) calc(50% + 0.5px),
        transparent calc(50% + 0.5px));
  }
  .om-core-bars { display: flex; gap: 3px; align-items: flex-end; height: 100%; }
  .om-core-bar { flex: 1; min-width: 6px; border-radius: 2px 2px 0 0; transition: height .3s, background .3s; }

  .om-placeholder {
    border: 1px dashed var(--border-subtle-color);
    border-radius: var(--md-shape-sm, 8px); padding: 24px; text-align: center;
    color: var(--secondary-text-color); font: var(--md-typescale-body-medium);
  }

  .om-gw-spark .u-legend { display: none; }

  /* Tooltip (item #3, #11) */
  [data-tooltip] { position: relative; cursor: help; }
  [data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    background: var(--md-surface-container, #333); color: var(--on-surface-color);
    font: var(--md-typescale-label-small); padding: 4px 8px;
    border-radius: 4px; white-space: nowrap; z-index: 10;
    border: 1px solid var(--border-subtle-color);
  }

  /* Golden signals row */
  .om-golden {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 8px; margin-bottom: 12px; padding: 8px 0;
  }
  .om-golden-card {
    background: var(--md-surface-container, #1e1e1e);
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-xs, 4px);
    padding: 6px 10px; text-align: center;
  }
  .om-golden-label {
    font: var(--md-typescale-label-small);
    color: var(--secondary-text-color);
    text-transform: uppercase; letter-spacing: .03em;
  }
  .om-golden-val {
    font: var(--md-typescale-title-small);
    color: var(--on-surface-color);
    margin-top: 2px;
  }

  /* Services filter controls */
  .om-svc-controls {
    display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
    margin-bottom: 12px; padding: 8px 0;
  }
  .om-svc-controls input[type="text"] {
    padding: 4px 10px; border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-xs, 4px); background: var(--md-surface-container, #1e1e1e);
    color: var(--on-surface-color); font: var(--md-typescale-body-small);
    min-width: 140px;
  }
  .om-svc-controls select {
    padding: 4px 8px; border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-xs, 4px); background: var(--md-surface-container, #1e1e1e);
    color: var(--on-surface-color); font: var(--md-typescale-body-small);
  }
  .om-filter-btn {
    padding: 3px 10px; border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-full, 100px); background: transparent;
    color: var(--secondary-text-color); cursor: pointer;
    font: var(--md-typescale-label-small); transition: all .15s;
  }
  .om-filter-btn:hover { background: var(--md-state-hover); }
  .om-filter-btn.active {
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    color: var(--accent-color); border-color: var(--accent-color);
  }

  /* Envoy sections */
  .om-envoy-section { margin-bottom: 16px; }
  .om-envoy-section-title {
    font: var(--md-typescale-title-small); color: var(--on-surface-color);
    margin-bottom: 8px; display: flex; align-items: center; gap: 8px;
  }
  .om-stale-warning {
    padding: 8px 12px; border-radius: var(--md-shape-xs, 4px);
    background: color-mix(in srgb, var(--warning-color, #f59e0b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning-color, #f59e0b) 30%, transparent);
    color: var(--warning-color, #f59e0b);
    font: var(--md-typescale-body-small); margin-bottom: 12px;
  }

  /* Envoy cross-link */
  .om-svc-envoy-link {
    font: var(--md-typescale-label-small); color: var(--secondary-text-color);
    margin-top: 4px;
  }
  .om-svc-envoy-link a { color: var(--accent-color); text-decoration: none; }
  .om-svc-envoy-link a:hover { text-decoration: underline; }

  /* Time range picker */
  .om-range-picker {
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 10px; padding: 4px 0;
  }
  .om-range-label {
    font: var(--md-typescale-label-medium); color: var(--secondary-text-color);
  }
  .om-range-btn {
    padding: 3px 10px; border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-full, 100px); background: transparent;
    color: var(--secondary-text-color); cursor: pointer;
    font: var(--md-typescale-label-small); transition: all .15s;
  }
  .om-range-btn:hover { background: var(--md-state-hover); }
  .om-range-btn.active {
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    color: var(--accent-color); border-color: var(--accent-color);
  }
  .om-range-loading {
    font: var(--md-typescale-label-small); color: var(--secondary-text-color);
    font-style: italic;
  }
  .om-range-hint {
    font: var(--md-typescale-label-small); color: var(--secondary-text-color);
    opacity: 0.7;
  }
  .om-chart-unavailable {
    display: flex; align-items: center; justify-content: center;
    height: 150px; color: var(--secondary-text-color);
    font: var(--md-typescale-body-medium); opacity: 0.7;
    border: 1px dashed var(--border-subtle-color); border-radius: var(--md-shape-sm, 8px);
  }

  /* Per-node selection (overview table) */
  .om-node-table tbody tr { cursor: pointer; transition: background .15s; }
  .om-node-selected td {
    background: color-mix(in srgb, var(--accent-color) 12%, transparent) !important;
  }
  .om-node-selection-indicator {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; margin-bottom: 8px;
    background: color-mix(in srgb, var(--accent-color) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 25%, transparent);
    border-radius: var(--md-shape-xs, 4px);
    font: var(--md-typescale-label-medium); color: var(--on-surface-color);
  }
  .om-node-selection-indicator button {
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--accent-color); font: var(--md-typescale-label-small);
    text-decoration: underline;
  }
  .om-node-selection-indicator button:hover { opacity: .8; }
`

// ─── Range picker constants ──────────────────────────────────────────────────

type RangeOption = 900 | 3600 | 21600 | 86400
const RANGE_LABELS: { value: RangeOption; label: string }[] = [
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 21600, label: '6h' },
  { value: 86400, label: '24h' },
]

function chartRefreshInterval(range: RangeOption): number {
  if (range <= 3600) return 15_000
  if (range <= 21600) return 30_000
  return 60_000
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'nodes' | 'services' | 'storage' | 'gateway' | 'envoy'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'nodes',    label: 'Nodes' },
  { key: 'services', label: 'Services' },
  { key: 'storage',  label: 'Storage' },
  { key: 'gateway',  label: 'Gateway' },
  { key: 'envoy',    label: 'Envoy' },
]

// ─── Admin status → Severity mapper ─────────────────────────────────────

function statusToSeverity(status: string): Severity {
  switch (status) {
    case 'critical': return 'critical'
    case 'degraded': return 'warning'
    case 'healthy': return 'ok'
    default: return 'warning'
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

class PageObservabilityMetrics extends HTMLElement {
  private _tab: Tab = 'overview'
  private _ring = new StatsRingBuffer(60)
  private _health: ClusterHealth | null = null
  private _nodes: ClusterNode[] = []
  private _config: Record<string, any> | null = null
  private _objectStoreOk: boolean | null = null
  private _v1: ClusterHealthV1Result | null = null
  private _charts: uPlot[] = []
  private _svcMetrics: Map<string, ServiceProcessMetrics> = new Map()
  private _scrapeHealth: PrometheusScrapeHealth | null = null
  private _adminServices: ServicesResponse | null = null
  private _adminStorage: StorageResponse | null = null
  private _envoy: EnvoyResponse | null = null
  private _loading = true
  private _error = ''
  private _lastUpdated = 0
  // Prometheus history for charts
  private _overviewHistory: OverviewHistory | null = null
  private _gatewayHistory: GatewayHistory | null = null
  private _envoyHistoryProm: EnvoyHistory | null = null
  private _range: RangeOption = 3600  // default 1h
  private _historyLoading = false
  // Separate timers
  private _cardTimer: ReturnType<typeof setInterval> | null = null
  private _chartTimer: ReturnType<typeof setInterval> | null = null
  private _mountRafId: number | null = null
  private _statsTimer: ReturnType<typeof setInterval> | null = null
  // Help panel state
  private _helpOpen = false
  // Per-node selection (overview tab)
  private _selectedNode = ''
  // Services sort/filter state
  private _svcSort: 'status' | 'cpu' | 'mem' | 'rps' | 'err' | 'p95' | 'name' = 'name'
  private _svcFilter = ''
  private _svcCategoryFilter = ''
  private _svcStatusFilter = ''

  connectedCallback() {
    this.style.display = 'block'
    this._render()
    this._pollCards()
    this._pollStats()
    this._fetchHistory()
    this._cardTimer = setInterval(() => this._pollCards(), 5000)
    this._statsTimer = setInterval(() => this._pollStats(), 15000)
    this._startChartTimer()
  }

  disconnectedCallback() {
    if (this._cardTimer) { clearInterval(this._cardTimer); this._cardTimer = null }
    if (this._statsTimer) { clearInterval(this._statsTimer); this._statsTimer = null }
    if (this._chartTimer) { clearInterval(this._chartTimer); this._chartTimer = null }
    this._destroyCharts()
  }

  private _startChartTimer() {
    if (this._chartTimer) clearInterval(this._chartTimer)
    this._chartTimer = setInterval(() => this._fetchHistory(), chartRefreshInterval(this._range))
  }

  private _destroyCharts() {
    if (this._mountRafId !== null) {
      cancelAnimationFrame(this._mountRafId)
      this._mountRafId = null
    }
    for (const c of this._charts) c.destroy()
    this._charts = []
  }

  private async _pollCards() {
    const results = await Promise.allSettled([
      getClusterHealth(),
      listClusterNodes(),
      this._checkObjectStore(),
      this._fetchConfig(),
      getClusterHealthV1Full(),
      fetchServiceProcessMetrics(),
      getPrometheusScrapeHealth(),
      fetchAdminServices(),
      fetchAdminStorage(),
      fetchAdminEnvoy(),
    ])

    if (results[0].status === 'fulfilled') this._health = results[0].value
    if (results[1].status === 'fulfilled') this._nodes = results[1].value
    if (results[2].status === 'fulfilled') this._objectStoreOk = results[2].value
    if (results[3].status === 'fulfilled') this._config = results[3].value
    if (results[4].status === 'fulfilled') this._v1 = results[4].value
    if (results[5].status === 'fulfilled') this._svcMetrics = results[5].value
    if (results[6].status === 'fulfilled') this._scrapeHealth = results[6].value
    if (results[7].status === 'fulfilled') this._adminServices = results[7].value
    if (results[8].status === 'fulfilled') this._adminStorage = results[8].value
    if (results[9].status === 'fulfilled') this._envoy = results[9].value

    this._loading = false
    this._lastUpdated = Date.now()

    // Stale selection guard: clear if selected node no longer in list
    if (this._selectedNode && this._nodes.length > 0 &&
        !this._nodes.some(n => n.hostname === this._selectedNode)) {
      this._selectedNode = ''
      this._overviewHistory = null
      this._fetchHistory()
    }

    if (!this._tryUpdateCharts()) {
      this._render()
    }
  }

  private async _pollStats() {
    try {
      const stats = await fetchGatewayStats()
      this._ring.push(stats)
      this._error = ''
    } catch {
      this._error = 'Stats endpoint unreachable'
    }
  }

  private async _fetchHistory() {
    if (this._historyLoading) return
    this._historyLoading = true
    try {
      const [oh, gh, eh] = await Promise.allSettled([
        fetchOverviewHistory(this._range, this._selectedNode || undefined),
        fetchGatewayHistory(this._range),
        fetchEnvoyHistory(this._range),
      ])
      if (oh.status === 'fulfilled') this._overviewHistory = oh.value
      if (gh.status === 'fulfilled') this._gatewayHistory = gh.value
      if (eh.status === 'fulfilled') this._envoyHistoryProm = eh.value
    } catch {
      // leave existing values
    }
    this._historyLoading = false
    if (!this._tryUpdateCharts()) {
      this._render()
    }
  }

  private async _checkObjectStore(): Promise<boolean> {
    try { const r = await fetch('/health/objectstore'); return r.ok } catch { return false }
  }

  private async _fetchConfig(): Promise<Record<string, any>> {
    const r = await fetch('/config')
    if (!r.ok) throw new Error('config fetch failed')
    return r.json()
  }

  private _tryUpdateCharts(): boolean {
    if (this._charts.length === 0) return false
    this._updateLiveValues()

    if (this._tab === 'overview' && this._charts.length >= 4) {
      const h = this._overviewHistory
      if (h?.cpu) this._charts[0].setData(h.cpu)
      if (h?.memory) this._charts[1].setData(h.memory)
      if (h?.networkRx && h?.networkTx) {
        this._charts[2].setData([h.networkRx[0], h.networkRx[1], h.networkTx[1]] as any)
      }
      if (h?.disk) this._charts[3].setData(h.disk)
      return true
    }
    if (this._tab === 'gateway' && this._charts.length > 0) {
      const eh = this._envoyHistoryProm
      const oh = this._overviewHistory
      const gh = this._gatewayHistory
      let ci = 0
      // Envoy traffic sparklines
      if (eh?.rps) { if (ci < this._charts.length) this._charts[ci].setData(eh.rps); } ci++
      if (eh?.errors5xx) { if (ci < this._charts.length) this._charts[ci].setData(eh.errors5xx); } ci++
      if (eh?.p95Latency) { if (ci < this._charts.length) this._charts[ci].setData(eh.p95Latency); } ci++
      if (eh?.activeConns) { if (ci < this._charts.length) this._charts[ci].setData(eh.activeConns); } ci++
      // Resource sparklines
      if (oh?.cpu) { if (ci < this._charts.length) this._charts[ci].setData(oh.cpu); } ci++
      if (oh?.memory) { if (ci < this._charts.length) this._charts[ci].setData(oh.memory); } ci++
      if (gh?.goroutines) { if (ci < this._charts.length) this._charts[ci].setData(gh.goroutines); } ci++
      if (gh?.gcPause) { if (ci < this._charts.length) this._charts[ci].setData(gh.gcPause); } ci++
      return true
    }
    if (this._tab === 'envoy' && this._charts.length > 0) {
      const eh = this._envoyHistoryProm
      let ci = 0
      if (eh?.rps && ci < this._charts.length) this._charts[ci++].setData(eh.rps)
      if (eh?.errors5xx && ci < this._charts.length) this._charts[ci++].setData(eh.errors5xx)
      if (eh?.activeConns && ci < this._charts.length) this._charts[ci++].setData(eh.activeConns)
      if (eh?.rps && ci < this._charts.length) this._charts[ci++].setData(eh.rps)
      return true
    }
    return false
  }

  private _updateLiveValues() {
    const snap = this._ring.latest()
    if (!snap) return
    const s = snap.stats
    const hm = computeClusterHealth(this._health, s)
    this._setLive('cluster-badge', badge(hm.label, severityColor(hm.overall)))
    this._setLive('nodes-up', this._health ? `${this._health.healthyNodes} / ${this._health.totalNodes} up` : '--')

    // When a specific node is selected, local /stats values don't apply —
    // chart data comes from Prometheus. Show the selected hostname instead.
    if (this._selectedNode) {
      this._setLive('hostname', esc(this._selectedNode))
      this._setLive('uptime', '--')
      // cpu-val, mem-val, disk-val: leave as '--' (set at render time)
    } else {
      const cpuT = computeTrend(this._ring, x => x.cpu.usagePct)
      const memT = computeTrend(this._ring, x => x.memory.usedPct)
      this._setLive('cpu-val', fmtPct(s.cpu.usagePct) + trendHtml(cpuT))
      this._setLive('mem-val', fmtPct(s.memory.usedPct) + trendHtml(memT))
      this._setLive('disk-val', fmtPct(100 - s.disk.freePct))
      this._setLive('uptime', fmtDuration(s.uptimeSec))
      this._setLive('hostname', esc(s.hostname))
    }
    this._setLive('last-updated', this._lastUpdated ? `Updated ${this._ago(this._lastUpdated)}` : '')

    // Golden signals live updates
    const rps = this._envoy?.downstream.rps ?? 0
    const errors = this._envoy?.downstream.http_5xx_rate ?? 0
    let p95 = 0
    if (this._adminServices) {
      for (const g of this._adminServices.groups) {
        for (const svc of g.services) {
          if (svc.runtime && svc.runtime.latency_p95_ms > p95) p95 = svc.runtime.latency_p95_ms
        }
      }
    }
    this._setLive('golden-rps', fmtRate(rps))
    this._setLive('golden-errors', `<span style="color:${errors > 0 ? COLOR.critical : 'inherit'}">${fmtRate(errors)}</span>`)
    this._setLive('golden-p95', fmtMs(p95))
    this._setLive('golden-cpu', `<span style="color:${pctColor(s.cpu.usagePct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)}">${fmtPct(s.cpu.usagePct)}</span>`)
    this._setLive('golden-mem', `<span style="color:${pctColor(s.memory.usedPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)}">${fmtPct(s.memory.usedPct)}</span>`)
    this._setLive('golden-cluster', badge(hm.label, severityColor(hm.overall)))

    // Gateway tab traffic live updates
    const gwE = this._envoy
    if (gwE) {
      this._setLive('gw-rps', fmtRate(gwE.downstream.rps))
      this._setLive('gw-errors', `<span style="color:${gwE.downstream.http_5xx_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(gwE.downstream.http_5xx_rate)}</span>`)
      this._setLive('gw-p95', fmtMs(gwE.downstream.p95_ms))
      this._setLive('gw-conns', fmtCount(gwE.downstream.active_conns))
    }
    this._setLive('gw-cpu', `<span style="color:${pctColor(s.cpu.usagePct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)}">${fmtPct(s.cpu.usagePct)}</span>`)
    this._setLive('gw-mem', `<span style="color:${pctColor(s.memory.usedPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)}">${fmtPct(s.memory.usedPct)}</span>`)

    // Network RX/TX totals from Prometheus history
    const oh = this._overviewHistory
    const rangeLabel = RANGE_LABELS.find(r => r.value === this._range)?.label ?? ''
    const hasNetData = oh?.networkRx || oh?.networkTx
    this._setLive('net-rx-total', hasNetData ? fmtBytes(this._totalFromRate(oh?.networkRx ?? null)) : '--')
    this._setLive('net-tx-total', hasNetData ? fmtBytes(this._totalFromRate(oh?.networkTx ?? null)) : '--')
    this._setLive('net-rx-sub', `last ${rangeLabel}`)
    this._setLive('net-tx-sub', `last ${rangeLabel}`)
  }

  private _setLive(key: string, html: string) {
    const el = this.querySelector<HTMLElement>(`[data-live="${key}"]`)
    if (el) el.innerHTML = html
  }

  private _ago(ts: number): string {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 5) return 'just now'
    return `${sec}s ago`
  }

  private _renderScrapeIndicator(): string {
    const sh = this._scrapeHealth
    if (!sh) return ''
    const dotColor = sh.connected ? (sh.downTargets > 0 ? COLOR.warning : COLOR.healthy) : COLOR.critical
    const label = sh.connected
      ? (sh.lastScrapeAgo !== null ? `${sh.lastScrapeAgo}s ago` : 'connected')
      : 'disconnected'
    const detail = sh.connected && sh.activeTargets > 0
      ? ` &middot; ${sh.activeTargets} targets${sh.downTargets > 0 ? ` (${sh.downTargets} down)` : ''}`
      : ''
    return `<span class="om-scrape-badge" data-tooltip="Prometheus scrape status">
      <span class="om-scrape-dot" style="background:${dotColor};"></span>
      Prom: ${label}${detail}
    </span>`
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  private _render() {
    this._destroyCharts()

    const tabs = TABS.map(t =>
      `<button class="om-tab${this._tab === t.key ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('')

    let content = ''
    if (this._loading) {
      content = '<div class="om-loading">Loading metrics...</div>'
    } else if (this._error && !this._ring.latest()) {
      content = `<div class="om-error">${esc(this._error)}</div>`
    } else {
      switch (this._tab) {
        case 'overview': content = this._renderOverview(); break
        case 'nodes':    content = this._renderNodes(); break
        case 'services': content = this._renderServices(); break
        case 'storage':  content = this._renderStorage(); break
        case 'gateway':  content = this._renderGateway(); break
        case 'envoy':    content = this._renderEnvoy(); break
      }
    }

    this.innerHTML = `
      <style>${STYLES}</style>
      <section class="om-wrap">
        <div class="om-header">
          <h2>Metrics</h2>
          <div style="display:flex;align-items:center;">
            <span class="om-last-updated" data-live="last-updated">${this._lastUpdated ? `Updated ${this._ago(this._lastUpdated)}` : ''}</span>
            ${this._renderScrapeIndicator()}
          </div>
        </div>
        <p class="om-subtitle">Cluster health, resource utilization, and service status.</p>
        ${this._loading ? '' : this._renderGoldenSignals()}
        <div style="display:flex;align-items:center;">
          <div class="om-tabs" style="flex:1;">${tabs}</div>
          <paper-icon-button id="omInfoBtn" icon="icons:help-outline" title="Help for this tab"></paper-icon-button>
        </div>
        <iron-collapse id="omInfoPanel" class="info"${this._helpOpen ? ' opened' : ''}>
          <globular-markdown
            style="
              --content-bg-color: var(--surface-color);
              --content-text-color: var(--on-surface-color);
              --md-code-bg: color-mix(in srgb, var(--on-surface-color) 6%, var(--surface-color));
              --md-code-fg: var(--on-surface-color);
              --divider-color: color-mix(in srgb, var(--on-surface-color) 12%, transparent);
            "
          >${this._helpForTab(this._tab)}</globular-markdown>
        </iron-collapse>
        <div class="om-content">${content}</div>
      </section>
    `

    this.querySelector('#omInfoBtn')?.addEventListener('click', () => {
      this._helpOpen = !this._helpOpen;
      (this.querySelector('#omInfoPanel') as any)?.toggle()
    })

    this.querySelectorAll<HTMLButtonElement>('.om-tab').forEach(btn =>
      btn.addEventListener('click', () => { this._tab = btn.dataset.tab as Tab; this._render() })
    )
    this.querySelectorAll<HTMLButtonElement>('.om-health-toggle').forEach(btn =>
      btn.addEventListener('click', () => {
        navigateTo('#/admin/diagnostics')
      })
    )

    // Time range picker (shared across all chart tabs)
    this.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(btn =>
      btn.addEventListener('click', () => {
        const range = parseInt(btn.dataset.range!, 10) as RangeOption
        if (range !== this._range) {
          this._range = range
          this.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(b => {
            b.classList.toggle('active', b.dataset.range === String(range))
          })
          this._overviewHistory = null
          this._gatewayHistory = null
          this._envoyHistoryProm = null
          this._fetchHistory()
          this._startChartTimer()
        }
      })
    )

    // Services sort/filter controls
    const svcFilterInput = this.querySelector<HTMLInputElement>('[data-svc-filter]')
    if (svcFilterInput) {
      svcFilterInput.value = this._svcFilter
      svcFilterInput.addEventListener('input', () => { this._svcFilter = svcFilterInput.value; this._render() })
    }
    const svcSort = this.querySelector<HTMLSelectElement>('[data-svc-sort]')
    if (svcSort) {
      svcSort.value = this._svcSort
      svcSort.addEventListener('change', () => { this._svcSort = svcSort.value as any; this._render() })
    }
    this.querySelectorAll<HTMLButtonElement>('[data-svc-cat]').forEach(btn =>
      btn.addEventListener('click', () => { this._svcCategoryFilter = btn.dataset.svcCat!; this._render() })
    )
    this.querySelectorAll<HTMLButtonElement>('[data-svc-status]').forEach(btn =>
      btn.addEventListener('click', () => { this._svcStatusFilter = btn.dataset.svcStatus!; this._render() })
    )

    // Per-node selection: click rows in overview node table
    this.querySelectorAll<HTMLTableRowElement>('.om-node-table tbody tr[data-node-hostname]').forEach(row =>
      row.addEventListener('click', () => {
        const hostname = row.dataset.nodeHostname!
        this._selectedNode = this._selectedNode === hostname ? '' : hostname
        this._overviewHistory = null
        this._fetchHistory()
        this._render()
      })
    )
    // "Show all" button in selection indicator
    const showAllBtn = this.querySelector<HTMLButtonElement>('[data-show-all]')
    if (showAllBtn) {
      showAllBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this._selectedNode = ''
        this._overviewHistory = null
        this._fetchHistory()
        this._render()
      })
    }

    this._mountRafId = requestAnimationFrame(() => { this._mountRafId = null; this._mountCharts() })
  }

  // ── Golden Signals ─────────────────────────────────────────────────

  private _renderGoldenSignals(): string {
    const snap = this._ring.latest()
    const s = snap?.stats ?? null
    const hm = computeClusterHealth(this._health, s)

    const rps = this._envoy?.downstream.rps ?? 0
    const errors = this._envoy?.downstream.http_5xx_rate ?? 0

    // p95 latency: max across all services
    let p95 = 0
    if (this._adminServices) {
      for (const g of this._adminServices.groups) {
        for (const svc of g.services) {
          if (svc.runtime && svc.runtime.latency_p95_ms > p95) p95 = svc.runtime.latency_p95_ms
        }
      }
    }

    const cpuPct = s?.cpu.usagePct ?? 0
    const memPct = s?.memory.usedPct ?? 0

    return `
      <div class="om-golden">
        <div class="om-golden-card">
          <div class="om-golden-label">Cluster</div>
          <div class="om-golden-val" data-live="golden-cluster">${badge(hm.label, severityColor(hm.overall))}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label">Nodes</div>
          <div class="om-golden-val">${this._health ? `${this._health.healthyNodes}/${this._health.totalNodes}` : '--'}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label">RPS</div>
          <div class="om-golden-val" data-live="golden-rps">${fmtRate(rps)}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label">Errors</div>
          <div class="om-golden-val" data-live="golden-errors" style="color:${errors > 0 ? COLOR.critical : 'inherit'}">${fmtRate(errors)}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label" data-tooltip="95% of requests complete faster than this">p95 Latency</div>
          <div class="om-golden-val" data-live="golden-p95">${fmtMs(p95)}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label">CPU</div>
          <div class="om-golden-val" data-live="golden-cpu" style="color:${pctColor(cpuPct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)}">${fmtPct(cpuPct)}</div>
        </div>
        <div class="om-golden-card">
          <div class="om-golden-label">Memory</div>
          <div class="om-golden-val" data-live="golden-mem" style="color:${pctColor(memPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)}">${fmtPct(memPct)}</div>
        </div>
      </div>`
  }

  // ── Shared range picker ──────────────────────────────────────────────

  private _renderRangePicker(): string {
    const btns = RANGE_LABELS.map(r =>
      `<button class="om-range-btn${this._range === r.value ? ' active' : ''}" data-range="${r.value}">${r.label}</button>`
    ).join('')
    const noData = !this._overviewHistory && !this._gatewayHistory && !this._envoyHistoryProm && !this._historyLoading
    return `<div class="om-range-picker">
      <span class="om-range-label">History:</span>
      ${btns}
      ${this._historyLoading ? '<span class="om-range-loading">loading...</span>' : ''}
      ${noData ? '<span class="om-range-hint">Prometheus data unavailable</span>' : ''}
    </div>`
  }

  // ── Overview (items #1, #5, #6, #9) ──────────────────────────────────

  private _renderOverview(): string {
    const snap = this._ring.latest()
    const s = snap?.stats ?? null
    const hm = computeClusterHealth(this._health, s)
    const nodeSelected = !!this._selectedNode
    const cpuT = !nodeSelected && s ? computeTrend(this._ring, (x: GatewayStats) => x.cpu.usagePct) : null
    const memT = !nodeSelected && s ? computeTrend(this._ring, (x: GatewayStats) => x.memory.usedPct) : null

    return `
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">Cluster Status</div>
          <div class="om-stat-value"><span data-live="cluster-badge">${badge(hm.label, severityColor(hm.overall))}</span></div>
          <div class="om-health-section">
            <button class="om-health-toggle">Diagnose &#8594;</button>
          </div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Nodes</div>
          <div class="om-stat-value"><span data-live="nodes-up">${this._health ? `${this._health.healthyNodes} / ${this._health.totalNodes} up` : '--'}</span></div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Uptime</div>
          <div class="om-stat-value"><span data-live="uptime">${nodeSelected ? '--' : (s ? fmtDuration(s.uptimeSec) : '--')}</span></div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Hostname</div>
          <div class="om-stat-value" style="font:var(--md-typescale-title-medium);"><span data-live="hostname">${nodeSelected ? esc(this._selectedNode) : (s ? esc(s.hostname) : '--')}</span></div>
        </div>
      </div>

      ${this._renderRangePicker()}

      <!-- Row 2: CPU | Memory  —  Row 3: Network | Disk  (item #5 equal weight) -->
      <div class="om-chart-grid">
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title" style="color:${COLOR.cpu};">CPU</span>
            <span class="om-chart-value" data-live="cpu-val">${nodeSelected ? '--' : (s ? fmtPct(s.cpu.usagePct) + (cpuT ? trendHtml(cpuT) : '') : '--')}</span>
          </div>
          <div class="om-chart-wrap" data-chart="cpu"></div>
        </div>
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title" style="color:${COLOR.memory};">Memory</span>
            <span class="om-chart-value" data-live="mem-val">${nodeSelected ? '--' : (s ? fmtPct(s.memory.usedPct) + (memT ? trendHtml(memT) : '') : '--')}</span>
          </div>
          <div class="om-chart-wrap" data-chart="mem"></div>
        </div>
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title" style="color:${COLOR.network};">Network</span>
            <span class="om-chart-value" style="font:var(--md-typescale-label-large);color:${COLOR.network};">RX / TX bytes/s</span>
          </div>
          <div class="om-chart-wrap" data-chart="net"></div>
        </div>
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title" style="color:${COLOR.disk};">Disk</span>
            <span class="om-chart-value" data-live="disk-val" style="color:${nodeSelected ? COLOR.disk : (s ? diskUsedColor(100 - s.disk.freePct) : COLOR.disk)};">${nodeSelected ? '--' : (s ? fmtPct(100 - s.disk.freePct) : '--')}</span>
          </div>
          ${!nodeSelected && s ? `<div class="om-stat-sub" style="margin-bottom:4px;">
            ${fmtBytes(s.disk.usedBytes)} used of ${fmtBytes(s.disk.totalBytes)} &middot; ${fmtBytes(s.disk.totalBytes - s.disk.usedBytes)} free
          </div>` : ''}
          <div class="om-chart-wrap" data-chart="disk"></div>
        </div>
      </div>

      ${this._renderNodeTable()}
    `
  }

  private _renderNodeTable(): string {
    if (!this._nodes.length) return ''
    const s = this._ring.latest()?.stats
    const rows = this._nodes.map(n => {
      const caps = n.capabilities
      const cpuVal = s ? fmtPct(s.cpu.usagePct) : '--'
      const memVal = s ? fmtPct(s.memory.usedPct) : '--'
      const diskPct = caps && caps.diskBytes > 0 ? ((caps.diskBytes - caps.diskFreeBytes) / caps.diskBytes) * 100 : 0
      const nClr = n.status.toUpperCase() === 'HEALTHY' || n.status.toUpperCase() === 'ACTIVE' ? 'ok' as Severity : n.status.toUpperCase() === 'DEGRADED' || n.status.toUpperCase() === 'CONVERGING' ? 'warning' as Severity : 'critical' as Severity
      const selected = this._selectedNode === n.hostname
      return `<tr data-node-hostname="${esc(n.hostname)}"${selected ? ' class="om-node-selected"' : ''}>
        <td>${esc(n.hostname)}</td>
        <td>${sevBadge(n.status, nClr)}</td>
        <td>${cpuVal}</td><td>${memVal}</td>
        <td style="color:${diskUsedColor(diskPct)};">${caps ? fmtPct(diskPct) : '--'}</td>
      </tr>`
    }).join('')

    const indicator = this._selectedNode
      ? `<div class="om-node-selection-indicator">
          Showing: <strong>${esc(this._selectedNode)}</strong>
          <button data-show-all>Show all</button>
        </div>`
      : ''

    return `<div class="om-panel">
      <div class="om-panel-title">Nodes</div>
      ${indicator}
      <table class="om-table om-node-table">
        <thead><tr><th>Hostname</th><th>Status</th><th>CPU</th><th>Memory</th><th>Disk</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }

  // ── Nodes (items #3, #4) ─────────────────────────────────────────────

  private _renderNodes(): string {
    if (!this._nodes.length) return '<div class="om-loading">No nodes found</div>'
    const s = this._ring.latest()?.stats

    return `<div class="om-node-grid">${this._nodes.map(n => {
      const caps = n.capabilities
      const cpuPct = s?.cpu.usagePct ?? 0
      const memPct = s?.memory.usedPct ?? 0
      let diskPct = 0
      if (caps && caps.diskBytes > 0) diskPct = ((caps.diskBytes - caps.diskFreeBytes) / caps.diskBytes) * 100

      const cpuClr = pctColor(cpuPct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)
      const memClr = pctColor(memPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)
      const dskClr = diskUsedColor(diskPct)

      const statusSev: Severity = n.status.toUpperCase() === 'HEALTHY' || n.status.toUpperCase() === 'ACTIVE'
        ? 'ok' : n.status.toUpperCase() === 'DEGRADED' || n.status.toUpperCase() === 'CONVERGING' ? 'warning' : 'critical'
      const tooltip = n.status.toUpperCase() === 'CONVERGING' ? ' data-tooltip="Node is reconciling desired state"' : ''

      return `
        <div class="om-node-card">
          <div class="om-node-header">
            <span class="om-node-hostname">${esc(n.hostname)}</span>
            <span${tooltip}>${sevBadge(n.status, statusSev)}</span>
          </div>
          <div class="om-node-resources">
            <div class="om-node-res-item">
              <div class="om-node-res-label">CPU</div>
              <div class="om-node-res-val" style="color:${cpuClr};">${s ? fmtPct(cpuPct) : '--'}</div>
            </div>
            <div class="om-node-res-item">
              <div class="om-node-res-label">Memory</div>
              <div class="om-node-res-val" style="color:${memClr};">${s ? fmtPct(memPct) : '--'}</div>
            </div>
            <div class="om-node-res-item">
              <div class="om-node-res-label">Disk</div>
              <div class="om-node-res-val" style="color:${dskClr};">${caps ? fmtPct(diskPct) : '--'}</div>
            </div>
          </div>
          <div class="om-node-specs">
            ${caps ? `${caps.cpuCount} cores &middot; ${fmtBytes(caps.ramBytes)} RAM &middot; ${fmtBytes(caps.diskBytes)} disk` : '--'}
          </div>
        </div>`
    }).join('')}</div>`
  }

  // ── Services (item #4) — server-derived health ─────────────────────

  private _renderServices(): string {
    const as = this._adminServices
    if (!as) {
      // Fallback: try legacy /config-based rendering
      if (!this._config || !this._config.Services) return '<div class="om-loading">Loading services...</div>'
      return this._renderServicesLegacy()
    }
    if (!as.groups.length) return '<div class="om-loading">No services found</div>'

    const promBadge = as.prometheus.connected
      ? `<span class="om-scrape-badge" style="margin-bottom:8px;">
          <span class="om-scrape-dot" style="background:${COLOR.healthy};"></span>
          Prometheus connected
        </span>`
      : `<span class="om-scrape-badge" style="margin-bottom:8px;">
          <span class="om-scrape-dot" style="background:${COLOR.critical};"></span>
          Prometheus disconnected
        </span>`

    const summaryLine = `<div style="font:var(--md-typescale-body-small);color:var(--secondary-text-color);margin-bottom:12px;">
      ${as.summary.total} services &mdash;
      ${sevBadge(`${as.summary.healthy} healthy`, 'ok')}
      ${as.summary.degraded > 0 ? sevBadge(`${as.summary.degraded} degraded`, 'warning') : ''}
      ${as.summary.critical > 0 ? sevBadge(`${as.summary.critical} critical`, 'critical') : ''}
      ${as.summary.unknown > 0 ? badge(`${as.summary.unknown} unknown`, 'var(--secondary-text-color)') : ''}
      ${promBadge}
    </div>`

    // Sort/filter controls
    const categories = ['', ...new Set(as.groups.map((g: ServiceGroup) => g.category))]
    const catBtns = categories.map(c =>
      `<button class="om-filter-btn${this._svcCategoryFilter === c ? ' active' : ''}" data-svc-cat="${c}">${c || 'All'}</button>`
    ).join('')
    const statusBtns = ['', 'critical', 'degraded', 'healthy'].map(s =>
      `<button class="om-filter-btn${this._svcStatusFilter === s ? ' active' : ''}" data-svc-status="${s}">${s || 'All'}</button>`
    ).join('')

    const controls = `<div class="om-svc-controls">
      <input type="text" placeholder="Filter by name..." data-svc-filter />
      <span style="color:var(--secondary-text-color);font:var(--md-typescale-label-small);">Category:</span>
      ${catBtns}
      <span style="color:var(--secondary-text-color);font:var(--md-typescale-label-small);margin-left:8px;">Status:</span>
      ${statusBtns}
      <select data-svc-sort>
        <option value="status">Sort: Status</option>
        <option value="cpu">Sort: CPU</option>
        <option value="mem">Sort: Memory</option>
        <option value="rps">Sort: RPS</option>
        <option value="err">Sort: Errors</option>
        <option value="p95">Sort: p95</option>
        <option value="name">Sort: Name</option>
      </select>
    </div>`

    // Flatten, filter, sort all services
    const allSvcs: (ServiceInstance & { _cat: string })[] = []
    for (const g of as.groups) {
      for (const s of g.services) {
        allSvcs.push({ ...s, _cat: g.category })
      }
    }
    const filterLower = this._svcFilter.toLowerCase()
    const filtered = allSvcs.filter(s => {
      if (filterLower && !s.display_name.toLowerCase().includes(filterLower) && !s.name.toLowerCase().includes(filterLower)) return false
      if (this._svcCategoryFilter && s._cat !== this._svcCategoryFilter) return false
      if (this._svcStatusFilter && s.derived_status !== this._svcStatusFilter) return false
      return true
    })

    const statusOrder: Record<string, number> = { critical: 0, degraded: 1, unknown: 2, healthy: 3 }
    filtered.sort((a, b) => {
      switch (this._svcSort) {
        case 'status': return (statusOrder[a.derived_status] ?? 2) - (statusOrder[b.derived_status] ?? 2)
        case 'cpu': return (b.runtime?.cpu_pct ?? -1) - (a.runtime?.cpu_pct ?? -1)
        case 'mem': return (b.runtime?.memory_bytes ?? -1) - (a.runtime?.memory_bytes ?? -1)
        case 'rps': return (b.runtime?.req_rate ?? -1) - (a.runtime?.req_rate ?? -1)
        case 'err': return (b.runtime?.err_rate ?? -1) - (a.runtime?.err_rate ?? -1)
        case 'p95': return (b.runtime?.latency_p95_ms ?? -1) - (a.runtime?.latency_p95_ms ?? -1)
        case 'name': return a.display_name.localeCompare(b.display_name)
        default: return 0
      }
    })

    // Re-group by category, preserving sorted order
    const groupMap = new Map<string, (ServiceInstance & { _cat: string })[]>()
    for (const s of filtered) {
      const arr = groupMap.get(s._cat) || []
      arr.push(s)
      groupMap.set(s._cat, arr)
    }

    let groupsHtml = ''
    for (const [cat, svcs] of groupMap) {
      groupsHtml += `
        <div class="om-svc-group-title">${esc(cat)} (${svcs.length})</div>
        <div class="om-svc-grid">
          ${svcs.map(s => this._renderServiceTile(s)).join('')}
        </div>
        ${cat === 'Infrastructure' && as.infra ? this._renderInfraCards(as.infra) : ''}
      `
    }

    if (!filtered.length) {
      groupsHtml = '<div class="om-loading">No services match filters</div>'
    }

    return summaryLine + controls + groupsHtml
  }

  private _renderServiceTile(s: ServiceInstance): string {
    const sev = statusToSeverity(s.derived_status)
    const rt = s.runtime
    const reasons = s.reasons?.length ? s.reasons.join('; ') : ''

    // Build stats grid items
    const stats: string[] = []
    if (rt) {
      stats.push(this._statItem('CPU', `<span style="color:${pctColor(rt.cpu_pct, 70, 85)}">${fmtPct(rt.cpu_pct)}</span>`))
      stats.push(this._statItem('Memory', fmtBytes(rt.memory_bytes)))
      stats.push(this._statItem('Uptime', fmtDuration(rt.uptime_sec)))
      if (rt.req_rate > 0 || rt.latency_p50_ms > 0) {
        stats.push(this._statItem('RPS', fmtRate(rt.req_rate)))
        stats.push(this._statItem('Errors', `<span style="color:${rt.err_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(rt.err_rate)}</span>`))
        stats.push(this._statItem('p95', fmtMs(rt.latency_p95_ms), '95% of requests complete faster than this'))
      }
    }

    // Envoy cross-link
    let envoyLink = ''
    if (this._envoy) {
      const clusterName = serviceToClusterName(s.name)
      if (clusterName) {
        const cluster = this._envoy.clusters.find((c: EnvoyCluster) => c.name === clusterName)
        if (cluster && (cluster.active_conns > 0 || cluster.rps > 0)) {
          envoyLink = `<div class="om-svc-envoy-link">Envoy: ${fmtCount(cluster.active_conns)} conns, ${fmtRate(cluster.rps)}</div>`
        }
      }
    }

    return `
      <a class="om-svc-tile" href="#/services/${encodeURIComponent(s.name)}"${reasons ? ` data-tooltip="${esc(reasons)}"` : ''}>
        <span class="om-svc-dot" style="background:${severityColor(sev)};"></span>
        <div class="om-svc-info">
          <div class="om-svc-name">${esc(s.display_name)}</div>
          <div class="om-svc-meta">
            ${sevBadge(s.derived_status, sev)}
            ${s.version ? `<span>v${esc(s.version)}</span>` : ''}
            ${s.node ? `<span>${esc(s.node)}</span>` : ''}
          </div>
          ${stats.length ? `<div class="om-svc-divider"></div>
          <div class="om-svc-stats-grid">${stats.join('')}</div>` : ''}
          ${envoyLink}
        </div>
      </a>`
  }

  private _statItem(label: string, value: string, tooltip?: string): string {
    const tip = tooltip ? ` data-tooltip="${esc(tooltip)}"` : ''
    return `<div class="om-svc-stat-item"${tip}><div class="om-svc-stat-label">${label}</div><div class="om-svc-stat-val">${value}</div></div>`
  }

  private _renderInfraCards(infra: Record<string, InfraDetail>): string {
    const cards: string[] = []

    // etcd card
    const etcd = infra['etcd']
    if (etcd) {
      cards.push(`<div class="om-stat-card">
        <div class="om-stat-label">etcd</div>
        <div class="om-stat-sub">
          ${etcd.etcd_is_leader ? badge('Leader', COLOR.healthy) : badge('Follower', 'var(--secondary-text-color)')}
          &middot; DB ${fmtBytes(etcd.etcd_db_size_bytes ?? 0)}
          &middot; ${fmtCount(etcd.etcd_total_keys ?? 0)} keys
        </div>
      </div>`)
    }

    // envoy card
    const envoy = infra['envoy']
    if (envoy) {
      cards.push(`<div class="om-stat-card">
        <div class="om-stat-label">Envoy Proxy</div>
        <div class="om-stat-sub">
          ${fmtCount(envoy.envoy_active_conns ?? 0)} conns
          &middot; ${fmtRate(envoy.envoy_rps ?? 0)} downstream
          ${(envoy.envoy_http_5xx ?? 0) > 0 ? `&middot; <span style="color:${COLOR.critical}">${fmtRate(envoy.envoy_http_5xx!)} 5xx</span>` : ''}
        </div>
      </div>`)
    }

    // node card
    const node = infra['node']
    if (node) {
      const memPct = node.node_mem_total_bytes
        ? ((node.node_mem_total_bytes - (node.node_mem_avail_bytes ?? 0)) / node.node_mem_total_bytes * 100)
        : 0
      cards.push(`<div class="om-stat-card">
        <div class="om-stat-label">Node</div>
        <div class="om-stat-sub">
          load ${(node.node_load1 ?? 0).toFixed(2)} / ${(node.node_load5 ?? 0).toFixed(2)}
          &middot; mem ${fmtPct(memPct)}
          &middot; net &darr;${fmtBytes(node.node_net_rx_rate ?? 0)}/s &uarr;${fmtBytes(node.node_net_tx_rate ?? 0)}/s
        </div>
      </div>`)
    }

    if (!cards.length) return ''
    return `<div class="om-stat-grid" style="margin-top:8px;">${cards.join('')}</div>`
  }

  private _renderServicesLegacy(): string {
    const models = normalizeServices(this._config!.Services)
    const groups = groupNormalizedServices(models)
    if (!groups.length) return '<div class="om-loading">No services found</div>'
    const hasProm = this._svcMetrics.size > 0

    return groups.map((g: { category: string; services: ServiceHealthModel[] }) => `
      <div class="om-svc-group-title">${esc(g.category)}</div>
      <div class="om-svc-grid">
        ${g.services.map((s: ServiceHealthModel) => {
          const base = s.name.replace(/\.service$/, '').split('.')[0].toLowerCase()
          const pm = this._svcMetrics.get(base)
          let sev = s.severity
          if (pm) {
            if (pm.cpuPct > 85) sev = sev === 'critical' ? 'critical' : 'warning'
            if (pm.memoryBytes > 0 && pm.memoryBytes > 500 * 1024 * 1024) {
              sev = sev === 'critical' ? 'critical' : 'warning'
            }
          }
          return `
          <a class="om-svc-tile" href="#/services/${encodeURIComponent(s.name)}">
            <span class="om-svc-dot" style="background:${severityColor(sev)};"></span>
            <div class="om-svc-info">
              <div class="om-svc-name">${esc(s.displayName)}</div>
              <div class="om-svc-meta">
                ${sevBadge(s.state || 'unknown', sev)}
                ${s.version ? ` &middot; v${esc(s.version)}` : ''}
              </div>
              ${hasProm && pm ? `<div class="om-svc-stats">
                <span title="CPU usage">CPU ${fmtPct(pm.cpuPct)}</span>
                <span title="Resident memory">${fmtBytes(pm.memoryBytes)}</span>
                <span title="Uptime">${fmtDuration(pm.uptimeSec)}</span>
              </div>
              <div style="display:flex;gap:4px;margin-top:4px;">
                <div style="flex:1;">${miniBar(Math.min(pm.cpuPct, 100), pctColor(pm.cpuPct, 70, 85))}</div>
                <div style="flex:1;">${miniBar(Math.min(pm.memoryBytes / (512 * 1024 * 1024) * 100, 100), COLOR.memory)}</div>
              </div>` : ''}
            </div>
          </a>`
        }).join('')}
      </div>
    `).join('')
  }

  // ── Storage (item #2) — server-derived mounts + app paths ──────────

  private _renderStorage(): string {
    const st = this._adminStorage
    if (!st) {
      // Fallback: legacy /stats-based rendering
      return this._renderStorageLegacy()
    }

    const sev = statusToSeverity(st.derived_status)
    const label = st.derived_status === 'critical' ? 'CRITICAL' : st.derived_status === 'degraded' ? 'WARNING' : 'HEALTHY'
    const reasonText = st.reasons?.length ? st.reasons.join('; ') : ''

    // Object store check (still from /health/objectstore)
    const sm = computeStorageHealth(this._ring.latest()?.stats ?? null, this._objectStoreOk)
    let osLabel = 'Unknown'; let osColor = 'var(--secondary-text-color)'
    if (sm.objectStore === 'ok') { osLabel = 'OK'; osColor = COLOR.healthy }
    else if (sm.objectStore === 'at_risk') { osLabel = 'At Risk'; osColor = COLOR.warning }
    else if (sm.objectStore === 'down') { osLabel = 'Down'; osColor = COLOR.critical }

    return `
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">Storage Health</div>
          <div class="om-stat-value">${sevBadge(label, sev)}</div>
          ${reasonText ? `<div class="om-stat-sub">${esc(reasonText)}</div>` : ''}
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Object Store (MinIO)</div>
          <div class="om-stat-value">${badge(osLabel, osColor)}</div>
          ${sm.objectStoreNote ? `<div class="om-stat-sub">${esc(sm.objectStoreNote)}</div>` : ''}
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Mount Points</div>
          <div class="om-stat-value">${st.mounts.length}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Most Critical</div>
          <div class="om-stat-value" style="font:var(--md-typescale-title-medium);">${st.most_critical_mount ? esc(st.most_critical_mount) : '--'}</div>
        </div>
      </div>

      ${this._renderMountsTable(st.mounts, st.most_critical_mount)}
      ${this._renderAppPathsTable(st.applications)}
    `
  }

  private _renderMountsTable(mounts: MountInfo[], criticalMount: string): string {
    if (!mounts.length) return ''
    const rows = mounts.map(m => {
      const sev = statusToSeverity(m.status)
      const isCritical = m.mount_point === criticalMount && m.status !== 'healthy'
      const highlight = isCritical ? ' style="background:color-mix(in srgb,var(--error-color,#ef4444) 8%,transparent);"' : ''
      return `<tr${highlight}>
        <td>${esc(m.mount_point)}</td>
        <td style="font:var(--md-typescale-label-small);">${esc(m.device)}</td>
        <td>${esc(m.fs_type)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="om-progress-outer" style="height:8px;flex:1;min-width:60px;">
              <div class="om-progress-inner" style="width:${m.used_pct}%;background:${severityColor(sev)};"></div>
            </div>
            <span style="white-space:nowrap;">${fmtPct(m.used_pct)}</span>
          </div>
        </td>
        <td>${fmtBytes(m.total_bytes)}</td>
        <td>${fmtBytes(m.free_bytes)}</td>
        <td>${sevBadge(m.status, sev)}</td>
      </tr>`
    }).join('')
    return `<div class="om-panel">
      <div class="om-panel-title">Mount Points</div>
      <table class="om-table">
        <thead><tr><th>Mount</th><th>Device</th><th>FS</th><th>Usage</th><th>Total</th><th>Free</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }

  private _renderAppPathsTable(apps: ApplicationPath[]): string {
    if (!apps.length) return ''
    const rows = apps.map(a => {
      const statusColor = a.status === 'healthy' ? COLOR.healthy : a.status === 'at_risk' ? COLOR.warning : COLOR.critical
      return `<tr>
        <td><strong>${esc(a.name)}</strong></td>
        <td style="font:var(--md-typescale-label-small);word-break:break-all;">${esc(a.path)}</td>
        <td>${a.exists ? badge('exists', COLOR.healthy) : badge('missing', COLOR.critical)}</td>
        <td>${a.writable ? badge('writable', COLOR.healthy) : badge('read-only', COLOR.warning)}</td>
        <td style="font:var(--md-typescale-label-small);">${a.mount_point ? esc(a.mount_point) : '--'}</td>
        <td>${badge(a.status, statusColor)}</td>
      </tr>`
    }).join('')
    return `<div class="om-panel">
      <div class="om-panel-title">Application Storage Paths</div>
      <table class="om-table">
        <thead><tr><th>Application</th><th>Path</th><th>Exists</th><th>Writable</th><th>Mount</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }

  private _renderStorageLegacy(): string {
    const s = this._ring.latest()?.stats ?? null
    const sm = computeStorageHealth(s, this._objectStoreOk)
    const diskUsedPct = s ? 100 - s.disk.freePct : 0
    const dColor = s ? diskUsedColor(diskUsedPct) : COLOR.disk

    let osLabel = 'Unknown'; let osColor = 'var(--secondary-text-color)'
    if (sm.objectStore === 'ok') { osLabel = 'OK'; osColor = COLOR.healthy }
    else if (sm.objectStore === 'at_risk') { osLabel = 'At Risk'; osColor = COLOR.warning }
    else if (sm.objectStore === 'down') { osLabel = 'Down'; osColor = COLOR.critical }

    return `
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">Storage Health</div>
          <div class="om-stat-value">${sevBadge(sm.label, sm.overall)}</div>
          ${sm.reason ? `<div class="om-stat-sub">${esc(sm.reason)}</div>` : ''}
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Object Store (MinIO)</div>
          <div class="om-stat-value">${badge(osLabel, osColor)}</div>
          ${sm.objectStoreNote ? `<div class="om-stat-sub">${esc(sm.objectStoreNote)}</div>` : ''}
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Disk Used</div>
          <div class="om-stat-value" style="color:${dColor};">${s ? fmtBytes(s.disk.usedBytes) : '--'}</div>
          <div class="om-stat-sub">${s ? `of ${fmtBytes(s.disk.totalBytes)}` : ''}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Disk Free</div>
          <div class="om-stat-value" style="color:${s ? diskFreeColor(s.disk.freePct) : COLOR.disk};">${s ? fmtBytes(s.disk.totalBytes - s.disk.usedBytes) : '--'}</div>
          <div class="om-stat-sub">${s ? fmtPct(s.disk.freePct) : ''}</div>
        </div>
      </div>

      ${s ? `<div class="om-panel">
        <div class="om-panel-title">Disk Capacity (${esc(s.disk.path)})</div>
        <div style="display:flex;justify-content:space-between;font:var(--md-typescale-body-small);color:var(--secondary-text-color);margin-bottom:4px;">
          <span>Used: ${fmtBytes(s.disk.usedBytes)}</span>
          <span>Free: ${fmtBytes(s.disk.totalBytes - s.disk.usedBytes)}</span>
        </div>
        <div class="om-progress-outer" style="height:12px;">
          <div class="om-progress-inner" style="width:${diskUsedPct}%;background:${dColor};"></div>
        </div>
      </div>` : ''}

      <div class="om-placeholder">Bucket counts and ScyllaDB status coming soon.</div>
    `
  }

  // ── Gateway (items #8, #9, #11) ──────────────────────────────────────

  private _renderGateway(): string {
    const s = this._ring.latest()?.stats ?? null
    const gc = computeGCPercentiles(this._ring)
    const e = this._envoy
    const hasEnvoy = !!e
    const promDown = this._scrapeHealth?.connected === false || e?.prometheus?.connected === false
    const dimStyle = hasEnvoy ? '' : 'opacity:0.45;'

    return `
      ${promDown ? '<div class="om-stale-warning">Prometheus disconnected &mdash; metrics shown are local node only</div>' : ''}

      ${this._renderRangePicker()}

      <!-- Traffic (from Envoy) -->
      <div class="om-gw-grid">
        <div class="om-gw-card" style="${dimStyle}">
          <div class="om-gw-label" style="color:${COLOR.healthy};">RPS</div>
          <div class="om-gw-value" data-live="gw-rps">${hasEnvoy ? fmtRate(e!.downstream.rps) : '--'}</div>
          ${!hasEnvoy ? '<div class="om-stat-sub">Envoy data unavailable</div>' : ''}
          <div class="om-gw-spark" data-gw-spark="rps"></div>
        </div>
        <div class="om-gw-card" style="${dimStyle}">
          <div class="om-gw-label" style="color:${COLOR.critical};">Error Rate (5xx)</div>
          <div class="om-gw-value" data-live="gw-errors">${hasEnvoy ? `<span style="color:${e!.downstream.http_5xx_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(e!.downstream.http_5xx_rate)}</span>` : '--'}</div>
          ${!hasEnvoy ? '<div class="om-stat-sub">Envoy data unavailable</div>' : ''}
          <div class="om-gw-spark" data-gw-spark="errors"></div>
        </div>
        <div class="om-gw-card" style="${dimStyle}">
          <div class="om-gw-label" style="color:${COLOR.warning};" data-tooltip="95% of requests complete faster than this">p95 Latency</div>
          <div class="om-gw-value" data-live="gw-p95">${hasEnvoy ? fmtMs(e!.downstream.p95_ms) : '--'}</div>
          ${hasEnvoy ? `<div class="om-stat-sub">p50 ${fmtMs(e!.downstream.p50_ms)} &middot; p99 ${fmtMs(e!.downstream.p99_ms)}</div>` : '<div class="om-stat-sub">Envoy data unavailable</div>'}
          <div class="om-gw-spark" data-gw-spark="p95"></div>
        </div>
        <div class="om-gw-card" style="${dimStyle}">
          <div class="om-gw-label" style="color:${COLOR.network};">Active Connections</div>
          <div class="om-gw-value" data-live="gw-conns">${hasEnvoy ? fmtCount(e!.downstream.active_conns) : '--'}</div>
          ${!hasEnvoy ? '<div class="om-stat-sub">Envoy data unavailable</div>' : ''}
          <div class="om-gw-spark" data-gw-spark="conns"></div>
        </div>
      </div>

      <!-- Resources (from gateway /stats) -->
      <div class="om-gw-grid">
        <div class="om-gw-card">
          <div class="om-gw-label" style="color:${COLOR.cpu};">CPU</div>
          <div class="om-gw-value" data-live="gw-cpu">${s ? `<span style="color:${pctColor(s.cpu.usagePct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)}">${fmtPct(s.cpu.usagePct)}</span>` : '--'}</div>
          ${s ? miniBar(s.cpu.usagePct, pctColor(s.cpu.usagePct, THRESHOLDS.cpu.warn, THRESHOLDS.cpu.crit)) : ''}
          <div class="om-gw-spark" data-gw-spark="cpu"></div>
        </div>
        <div class="om-gw-card">
          <div class="om-gw-label" style="color:${COLOR.memory};">Memory</div>
          <div class="om-gw-value" data-live="gw-mem">${s ? `<span style="color:${pctColor(s.memory.usedPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)}">${fmtPct(s.memory.usedPct)}</span>` : '--'}</div>
          ${s ? `<div class="om-stat-sub">${fmtBytes(s.memory.usedBytes)} / ${fmtBytes(s.memory.totalBytes)}</div>` : ''}
          ${s ? miniBar(s.memory.usedPct, pctColor(s.memory.usedPct, THRESHOLDS.memory.warn, THRESHOLDS.memory.crit)) : ''}
          <div class="om-gw-spark" data-gw-spark="mem"></div>
        </div>
        <div class="om-gw-card">
          <div class="om-gw-label" style="color:${COLOR.gateway};">Goroutines</div>
          <div class="om-gw-value">${s ? s.go.goroutines : '--'}</div>
          <div class="om-gw-spark" data-gw-spark="goroutines"></div>
        </div>
        <div class="om-gw-card" data-tooltip="GC pause is stop-the-world latency">
          <div class="om-gw-label" style="color:${COLOR.disk};">GC Pause</div>
          <div class="om-gw-value">${gc.count > 0 ? `p50 ${fmtNs(gc.p50)}` : '--'}</div>
          <div class="om-stat-sub">${gc.count > 0 ? `p95 ${fmtNs(gc.p95)} &middot; ${gc.count} cycles` : ''}</div>
          <div class="om-gw-spark" data-gw-spark="gc"></div>
        </div>
      </div>

      <!-- Secondary diagnostics -->
      <div class="om-stat-grid">
        ${this._renderNetworkCards()}
        <div class="om-stat-card">
          <div class="om-stat-label">Uptime</div>
          <div class="om-stat-value"><span data-live="uptime">${s ? fmtDuration(s.uptimeSec) : '--'}</span></div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Hostname</div>
          <div class="om-stat-value" style="font:var(--md-typescale-title-medium);"><span data-live="hostname">${s ? esc(s.hostname) : '--'}</span></div>
        </div>
      </div>
    `
  }

  // ── Envoy ──────────────────────────────────────────────────────────────

  /** Compute total bytes from a Prometheus rate series: sum(rate × step). */
  private _totalFromRate(series: [number[], number[]] | null): number {
    if (!series || series[0].length < 2) return 0
    const [ts, vals] = series
    let total = 0
    for (let i = 1; i < ts.length; i++) {
      const step = ts[i] - ts[i - 1]
      total += vals[i] * step
    }
    return total
  }

  private _renderNetworkCards(): string {
    const oh = this._overviewHistory
    const rangeLabel = RANGE_LABELS.find(r => r.value === this._range)?.label ?? ''
    const rxTotal = this._totalFromRate(oh?.networkRx ?? null)
    const txTotal = this._totalFromRate(oh?.networkTx ?? null)
    const hasData = oh?.networkRx || oh?.networkTx

    return `
        <div class="om-stat-card">
          <div class="om-stat-label" style="color:${COLOR.network};" data-tooltip="Total bytes received over the last ${rangeLabel}">Network RX</div>
          <div class="om-stat-value" data-live="net-rx-total">${hasData ? fmtBytes(rxTotal) : '--'}</div>
          <div class="om-stat-sub" data-live="net-rx-sub">last ${rangeLabel}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label" style="color:${COLOR.network};" data-tooltip="Total bytes transmitted over the last ${rangeLabel}">Network TX</div>
          <div class="om-stat-value" data-live="net-tx-total">${hasData ? fmtBytes(txTotal) : '--'}</div>
          <div class="om-stat-sub" data-live="net-tx-sub">last ${rangeLabel}</div>
        </div>`
  }

  private _renderEnvoy(): string {
    const e = this._envoy
    if (!e) return '<div class="om-loading">Loading Envoy metrics...</div>'

    const stateColor = e.healthy ? COLOR.healthy : COLOR.critical
    const stateLabel = e.server.state || 'UNKNOWN'
    const promConnected = e.prometheus?.connected !== false

    // Cert expiry warning
    const certWarn = e.downstream.days_until_cert_expiry > 0 && e.downstream.days_until_cert_expiry < 30
      ? `<span style="margin-left:12px;color:${e.downstream.days_until_cert_expiry < 7 ? COLOR.critical : COLOR.warning};">
          Cert expires in ${Math.round(e.downstream.days_until_cert_expiry)}d
        </span>`
      : ''

    return `
      <!-- Health banner -->
      <div class="om-panel" style="border-left:3px solid ${stateColor};">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            ${badge(stateLabel, stateColor)}
            <span style="margin-left:8px;">Uptime ${fmtDuration(e.server.uptime_sec)}</span>
            ${certWarn}
          </div>
          <span style="font:var(--md-typescale-label-small);color:var(--secondary-text-color);">
            ${e.server.version ? esc(e.server.version) : ''}
            ${promConnected
              ? `<span class="om-scrape-badge"><span class="om-scrape-dot" style="background:${COLOR.healthy};"></span>Prom</span>`
              : `<span class="om-scrape-badge"><span class="om-scrape-dot" style="background:${COLOR.critical};"></span>Prom</span>`}
          </span>
        </div>
      </div>

      ${!promConnected ? '<div class="om-stale-warning">Prometheus disconnected &mdash; data may be stale</div>' : ''}

      ${this._renderRangePicker()}

      <!-- Stat cards -->
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">Active Connections</div>
          <div class="om-stat-value">${fmtCount(e.downstream.active_conns)}</div>
          <div class="om-gw-spark" data-envoy-spark="conns"></div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Downstream RPS</div>
          <div class="om-stat-value">${fmtRate(e.downstream.rps)}</div>
          <div class="om-gw-spark" data-envoy-spark="rps"></div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Response Codes</div>
          <div class="om-stat-sub">
            <span style="color:${COLOR.healthy}">2xx ${fmtRate(e.downstream.http_2xx_rate)}</span>
            <span style="color:${COLOR.warning}">4xx ${fmtRate(e.downstream.http_4xx_rate)}</span>
            <span style="color:${COLOR.critical}">5xx ${fmtRate(e.downstream.http_5xx_rate)}</span>
          </div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Memory</div>
          <div class="om-stat-value">${fmtBytes(e.server.mem_allocated_bytes)}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Downstream Latency</div>
          <div class="om-stat-sub">
            p50 ${fmtMs(e.downstream.p50_ms)}
            &middot; p95 ${fmtMs(e.downstream.p95_ms)}
            &middot; p99 ${fmtMs(e.downstream.p99_ms)}
          </div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">SSL</div>
          <div class="om-stat-value">${fmtCount(e.downstream.ssl_conns)} active</div>
          <div class="om-stat-sub">${fmtRate(e.downstream.ssl_handshake_rate)} handshakes</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Network I/O</div>
          <div class="om-stat-sub">
            &darr; ${fmtBytes(e.downstream.rx_bytes_rate)}/s
            &uarr; ${fmtBytes(e.downstream.tx_bytes_rate)}/s
          </div>
        </div>
      </div>

      <!-- Charts -->
      <div class="om-chart-grid">
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title">Downstream RPS</span>
            <span class="om-chart-value">${fmtRate(e.downstream.rps)}</span>
          </div>
          <div class="om-chart-wrap" data-envoy-chart="rps"></div>
        </div>
        <div class="om-chart-panel">
          <div class="om-chart-header">
            <span class="om-chart-title">Error Rate (5xx)</span>
            <span class="om-chart-value" style="color:${e.downstream.http_5xx_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(e.downstream.http_5xx_rate)}</span>
          </div>
          <div class="om-chart-wrap" data-envoy-chart="errors"></div>
        </div>
      </div>

      <!-- Listeners section -->
      ${this._renderEnvoyListeners(e.listeners)}

      <!-- TLS section -->
      ${this._renderEnvoyTLS(e)}

      <!-- xDS Control Plane -->
      ${this._renderEnvoyXDS(e.xds)}

      <!-- Upstream Clusters -->
      ${this._renderEnvoyClusters(e.clusters)}
    `
  }

  private _renderEnvoyListeners(listeners: EnvoyListener[]): string {
    if (!listeners || !listeners.length) return ''
    const rows = listeners.map(l => `<tr>
      <td style="font:var(--md-typescale-label-small);">${esc(l.address)}</td>
      <td>${fmtCount(l.active_conns)}</td>
      <td>${fmtRate(l.rps)}</td>
      <td>${fmtRate(l.ssl_handshake_rate)}</td>
      <td style="color:${l.ssl_error_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(l.ssl_error_rate)}</td>
    </tr>`).join('')

    return `<div class="om-panel om-envoy-section">
      <div class="om-envoy-section-title">Listeners (${listeners.length})</div>
      <table class="om-table">
        <thead><tr><th>Address</th><th>Conns</th><th>Conn/s</th><th>TLS handshakes/s</th><th>TLS errors/s</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }

  private _renderEnvoyTLS(e: EnvoyResponse): string {
    const d = e.downstream
    if (!d.ssl_conns && !d.ssl_handshake_rate && !d.ssl_error_rate && !d.days_until_cert_expiry) return ''

    const certColor = d.days_until_cert_expiry > 0
      ? (d.days_until_cert_expiry < 7 ? COLOR.critical : d.days_until_cert_expiry < 30 ? COLOR.warning : COLOR.healthy)
      : 'var(--secondary-text-color)'

    return `<div class="om-envoy-section">
      <div class="om-envoy-section-title">TLS</div>
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">Handshakes/s</div>
          <div class="om-stat-value">${fmtRate(d.ssl_handshake_rate)}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Errors/s</div>
          <div class="om-stat-value" style="color:${d.ssl_error_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(d.ssl_error_rate)}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Active SSL Conns</div>
          <div class="om-stat-value">${fmtCount(d.ssl_conns)}</div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">Cert Expiry</div>
          <div class="om-stat-value" style="color:${certColor}">
            ${d.days_until_cert_expiry > 0 ? `${Math.round(d.days_until_cert_expiry)}d` : '--'}
          </div>
        </div>
      </div>
    </div>`
  }

  private _renderEnvoyXDS(xds: EnvoyXDS): string {
    if (!xds) return ''

    const routeRows = (xds.routes || []).map((r: RDSRoute) => {
      const connBadge = r.connected === 1
        ? badge('connected', COLOR.healthy)
        : badge('disconnected', COLOR.critical)
      return `<tr>
        <td>${esc(r.name)}</td>
        <td>${connBadge}</td>
        <td>${fmtCount(r.update_success)}</td>
        <td style="color:${r.update_failure > 0 ? COLOR.critical : 'inherit'}">${fmtCount(r.update_failure)}</td>
      </tr>`
    }).join('')

    return `<div class="om-envoy-section">
      <div class="om-envoy-section-title">xDS Control Plane</div>
      <div class="om-stat-grid">
        <div class="om-stat-card">
          <div class="om-stat-label">CDS (Clusters)</div>
          <div class="om-stat-value">${fmtCount(xds.active_clusters)} active</div>
          <div class="om-stat-sub">
            <span style="color:${COLOR.healthy}">${fmtCount(xds.cds_update_success)} ok</span>
            ${xds.cds_update_failure > 0 ? `<span style="color:${COLOR.critical}">${fmtCount(xds.cds_update_failure)} fail</span>` : ''}
          </div>
        </div>
        <div class="om-stat-card">
          <div class="om-stat-label">LDS (Listeners)</div>
          <div class="om-stat-value">${fmtCount(xds.active_listeners)} active</div>
          <div class="om-stat-sub">
            <span style="color:${COLOR.healthy}">${fmtCount(xds.lds_update_success)} ok</span>
            ${xds.lds_update_failure > 0 ? `<span style="color:${COLOR.critical}">${fmtCount(xds.lds_update_failure)} fail</span>` : ''}
          </div>
        </div>
      </div>
      ${routeRows ? `
        <div class="om-panel" style="margin-top:8px;">
          <div class="om-panel-title">RDS Routes</div>
          <table class="om-table">
            <thead><tr><th>Route</th><th>State</th><th>Updates OK</th><th>Failures</th></tr></thead>
            <tbody>${routeRows}</tbody>
          </table>
        </div>
      ` : ''}
    </div>`
  }

  private _renderEnvoyClusters(clusters: EnvoyCluster[]): string {
    return `<div class="om-panel">
      <div class="om-panel-title">Upstream Clusters (${clusters.length})</div>
      ${clusters.length ? `
        <table class="om-table">
          <thead>
            <tr>
              <th>Cluster</th>
              <th>Health</th>
              <th>RPS</th>
              <th>Err/s</th>
              <th>p50</th>
              <th>p99</th>
              <th>Conns</th>
              <th>Retries/s</th>
              <th>Timeouts/s</th>
              <th>CB</th>
              <th>Traffic</th>
            </tr>
          </thead>
          <tbody>
            ${clusters.map(c => {
              const rowStyle = c.unhealthy > 0 ? 'border-left:3px solid ' + COLOR.critical : ''
              const svcName = clusterToServiceName(c.name)
              const nameCell = svcName
                ? `<a href="#/services/${encodeURIComponent(svcName)}" style="color:var(--accent-color);text-decoration:none;">${esc(c.name)}</a>`
                : esc(c.name)
              return `<tr style="${rowStyle}">
                <td>${nameCell}</td>
                <td>
                  <span style="color:${COLOR.healthy}">${c.healthy}</span>
                  ${c.degraded > 0 ? `/ <span style="color:${COLOR.warning}">${c.degraded}</span>` : ''}
                  ${c.unhealthy > 0 ? `/ <span style="color:${COLOR.critical}">${c.unhealthy}</span>` : ''}
                </td>
                <td>${fmtRate(c.rps)}</td>
                <td style="color:${c.err_rate > 0 ? COLOR.critical : 'inherit'}">${fmtRate(c.err_rate)}</td>
                <td>${fmtMs(c.p50_ms)}</td>
                <td>${fmtMs(c.p99_ms)}</td>
                <td>${fmtCount(c.active_conns)}</td>
                <td style="color:${(c.retry_rate ?? 0) > 0 ? COLOR.warning : 'inherit'}">${fmtRate(c.retry_rate ?? 0)}</td>
                <td style="color:${(c.timeout_rate ?? 0) > 0 ? COLOR.critical : 'inherit'}">${fmtRate(c.timeout_rate ?? 0)}</td>
                <td>${(c.circuit_breaker_open ?? 0) > 0 ? badge('OPEN', COLOR.critical) : badge('closed', 'var(--secondary-text-color)')}</td>
                <td style="font:var(--md-typescale-label-small)">
                  &darr;${fmtBytes(c.rx_bytes_rate)}/s &uarr;${fmtBytes(c.tx_bytes_rate)}/s
                </td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      ` : '<div class="om-loading">No upstream clusters</div>'}
    </div>`
  }

  private _mountEnvoyCharts() {
    const eh = this._envoyHistoryProm
    const empty: [number[], number[]] = [[], []]

    const rpsEl = this.querySelector<HTMLElement>('[data-envoy-chart="rps"]')
    if (rpsEl) this._mkChart(rpsEl, eh?.rps ?? empty, 'RPS', COLOR.healthy, 150)

    const errEl = this.querySelector<HTMLElement>('[data-envoy-chart="errors"]')
    if (errEl) this._mkChart(errEl, eh?.errors5xx ?? empty, '5xx', COLOR.critical, 150)

    const sparkSpecs: Array<{ sel: string; data: [number[], number[]] | null; clr: string }> = [
      { sel: '[data-envoy-spark="conns"]', data: eh?.activeConns ?? null, clr: COLOR.network },
      { sel: '[data-envoy-spark="rps"]', data: eh?.rps ?? null, clr: COLOR.healthy },
    ]
    for (const { sel, data, clr } of sparkSpecs) {
      const el = this.querySelector<HTMLElement>(sel)
      if (el) this._mkSpark(el, data ?? empty, clr)
    }
  }

  // ─── Chart mounting ───────────────────────────────────────────────────

  // ── Help content per tab ─────────────────────────────────────────────

  private _helpForTab(tab: Tab): string {
    switch (tab) {
      case 'overview': return `
## Overview

This tab shows the cluster's overall health at a glance.

### Golden Signals (top bar)

| Indicator | Meaning |
|---|---|
| **Cluster** | Aggregate health status derived from all checks below |
| **Nodes** | How many nodes are reporting as healthy out of the total |
| **RPS** | Requests per second flowing through the Envoy gateway |
| **Errors** | HTTP 5xx errors per second — red when > 0 |
| **p95 Latency** | 95 % of requests complete faster than this value |
| **CPU / Memory** | Current utilization of the local node |

### Stat Cards

- **Cluster Status** — click *Diagnose* to open the full Diagnostics page for severity-grouped findings and remediation
- **Nodes** — healthy vs total count
- **Uptime** — how long the local gateway process has been running
- **Hostname** — the machine serving the admin UI

### Charts

All four charts (CPU, Memory, Network, Disk) pull data from **Prometheus** over the selected time range.
Use the **15m / 1h / 6h / 24h** buttons to change the window. When Prometheus is unreachable, charts show "Prometheus data unavailable."

### Node Table

Click a **node row** to filter all four charts to that specific node. Click again or press **Show all** to return to the cluster aggregate view.
`

      case 'nodes': return `
## Nodes

Each card represents one machine in the cluster.

| Field | Meaning |
|---|---|
| **Status badge** | Current health reported by the node agent — *Healthy*, *Converging* (reconciling desired state), or *Degraded* |
| **CPU / Memory / Disk** | Resource utilization percentages. Colors shift from green to yellow to red as thresholds are crossed |
| **Specs line** | Hardware summary — CPU core count, total RAM, total disk |

> Metrics currently reflect the **local gateway node** for all cards. Per-node Prometheus metrics are shown when you select a node on the Overview tab.
`

      case 'services': return `
## Services

Lists every registered service grouped by category (Infrastructure, Platform, Application).

### Tile Fields

| Field | Meaning |
|---|---|
| **Status dot** | Green = healthy, yellow = degraded, red = critical |
| **Status badge** | Derived status — combines gRPC health-check, Prometheus liveness, and Envoy reachability |
| **Version** | Reported service version |
| **CPU** | Process CPU usage (colored by threshold) |
| **Memory** | Resident memory (RSS) of the process |
| **Uptime** | Time since the process started |
| **RPS** | Inbound request rate (only shown when traffic is flowing) |
| **Errors** | Error rate — red when > 0 |
| **p95** | 95th-percentile latency — 95 % of requests are faster than this |
| **Envoy line** | Appears when the service has active connections through the Envoy proxy |

### Controls

- **Filter** — type to search by service name
- **Category / Status buttons** — narrow the view
- **Sort dropdown** — order tiles by status severity, CPU, memory, RPS, errors, p95, or name
`

      case 'storage': return `
## Storage

Shows filesystem and object-store health.

### Summary Cards

| Card | Meaning |
|---|---|
| **Storage Health** | Overall derived status across all mount points |
| **Object Store (MinIO)** | Whether the MinIO health endpoint responds — *OK*, *At Risk*, or *Down* |
| **Mount Points** | Number of monitored filesystems |
| **Most Critical** | The mount point closest to a warning or critical threshold |

### Mount Points Table

| Column | Meaning |
|---|---|
| **Usage bar** | Visual fill + percentage — green < 80 %, yellow 80–90 %, red > 90 % |
| **Total / Free** | Filesystem capacity and available space |
| **Status** | Derived from usage percentage thresholds |

### Application Storage Paths

Lists important directories used by services (data, config, certs). Flags whether each path **exists**, is **writable**, which **mount** it sits on, and its overall status.
`

      case 'gateway': return `
## Gateway

Metrics for the Envoy reverse-proxy and the Go gateway process that serves the admin UI.

### Traffic Cards (top row)

| Card | Meaning |
|---|---|
| **RPS** | Total downstream requests per second through Envoy |
| **Errors** | HTTP 5xx responses per second — red when > 0 |
| **p95 Latency** | 95 % of downstream requests finish within this time |
| **Active Conns** | Current number of open client connections |

### Resource Cards (bottom row)

| Card | Meaning |
|---|---|
| **CPU / Memory** | Gateway process utilization |
| **Goroutines** | Number of Go goroutines — rising steadily may indicate a leak |
| **GC Pause** | Go garbage-collector stop-the-world pause — p50 and p95 |

### Sparklines

Each card includes a small chart showing the trend over the selected time range. Sparklines update automatically every 15–60 s depending on the range.

### Network RX / TX

Total bytes received and transmitted over the selected time window (15m / 1h / 6h / 24h), computed from Prometheus rate data.
`

      case 'envoy': return `
## Envoy

Detailed Envoy proxy internals — useful for debugging routing and connectivity issues.

### Overview Cards

| Card | Meaning |
|---|---|
| **State** | Envoy server state — *LIVE* means healthy |
| **RPS / Errors / Latency** | Same downstream metrics as the Gateway tab |
| **Uptime** | Time since Envoy started |

### Listeners

Each listener is a port Envoy binds to. Shows the address, active connections, and whether the listener is draining (shutting down gracefully).

### TLS

Certificate details for the downstream listener: issuer, subject, serial number, validity dates, and days until expiry. A warning appears when the certificate is within 30 days of expiring.

### xDS Sync

Shows the control-plane synchronization status for each xDS resource type:

| Type | What it controls |
|---|---|
| **LDS** (Listener) | Listener configuration |
| **RDS** (Route) | Routing rules — which URL paths map to which service clusters |
| **CDS** (Cluster) | Upstream cluster definitions (service backends) |
| **EDS** (Endpoint) | Endpoint addresses within each cluster |

*SYNCED* means the configuration is current. *STALE* or *ERROR* indicates a control-plane problem.

### Routes

The RDS route table — shows virtual hosts and the match rules (prefix, path) that route traffic to upstream clusters.

### Clusters

Each cluster is an upstream service backend. Shows health status, active connections, RPS, and success rate.
`
    }
  }

  private _mountCharts() {
    if (this._tab === 'overview') this._mountOverviewCharts()
    if (this._tab === 'gateway') this._mountGatewayCharts()
    if (this._tab === 'envoy') this._mountEnvoyCharts()
  }

  private _mountOverviewCharts() {
    const c = this.querySelector.bind(this)
    const h = this._overviewHistory

    const cpu = c<HTMLElement>('[data-chart="cpu"]')
    const mem = c<HTMLElement>('[data-chart="mem"]')
    const net = c<HTMLElement>('[data-chart="net"]')
    const disk = c<HTMLElement>('[data-chart="disk"]')

    const empty: [number[], number[]] = [[], []]
    if (cpu) this._mkChart(cpu, h?.cpu ?? empty, 'CPU %', COLOR.cpu, 150)
    if (mem) this._mkChart(mem, h?.memory ?? empty, 'Mem %', COLOR.memory, 150)
    if (net) {
      if (h?.networkRx && h?.networkTx) {
        this._mkNetChartFromHistory(net, h.networkRx, h.networkTx, 150)
      } else {
        this._mkNetChartFromHistory(net, empty, empty, 150)
      }
    }
    if (disk) this._mkChart(disk, h?.disk ?? empty, 'Disk %', COLOR.disk, 150)
  }

  private _mkNetChartFromHistory(el: HTMLElement, rx: [number[], number[]], tx: [number[], number[]], h: number) {
    const chart = new uPlot({
      width: el.clientWidth || 300, height: h,
      cursor: { show: true, drag: { x: false, y: false } },
      legend: { show: true },
      scales: { x: { time: true }, y: { auto: true } },
      axes: [
        { show: true, stroke: '#555', grid: { stroke: 'rgba(128,128,128,0.06)' }, ticks: { show: false }, font: '10px sans-serif',
          values: (u: uPlot, v: number[]) => this._timeAxisValues(u, v) },
        { show: true, stroke: '#555', grid: { stroke: 'rgba(128,128,128,0.06)' }, ticks: { show: false }, font: '10px sans-serif', size: 50,
          values: (_u: uPlot, v: number[]) => v.map(x => fmtBytes(x)) },
      ],
      series: [
        {},
        { label: 'RX', stroke: COLOR.network, width: 1.5, fill: COLOR.network + '1f' },
        { label: 'TX', stroke: COLOR.info, width: 1.5, fill: COLOR.info + '1f' },
      ],
    }, [rx[0], rx[1], tx[1]], el)
    this._charts.push(chart)
  }

  private _mountGatewayCharts() {
    const eh = this._envoyHistoryProm
    const oh = this._overviewHistory
    const gh = this._gatewayHistory
    const empty: [number[], number[]] = [[], []]

    // Traffic sparklines from Prometheus envoy history
    const envoySpecs: Array<{ sel: string; data: [number[], number[]] | null; clr: string }> = [
      { sel: '[data-gw-spark="rps"]', data: eh?.rps ?? null, clr: COLOR.healthy },
      { sel: '[data-gw-spark="errors"]', data: eh?.errors5xx ?? null, clr: COLOR.critical },
      { sel: '[data-gw-spark="p95"]', data: eh?.p95Latency ?? null, clr: COLOR.warning },
      { sel: '[data-gw-spark="conns"]', data: eh?.activeConns ?? null, clr: COLOR.network },
    ]
    for (const { sel, data, clr } of envoySpecs) {
      const el = this.querySelector<HTMLElement>(sel)
      if (el) this._mkSpark(el, data ?? empty, clr)
    }

    // Resource sparklines from Prometheus overview + gateway history
    const resSpecs: Array<{ sel: string; data: [number[], number[]] | null; clr: string }> = [
      { sel: '[data-gw-spark="cpu"]', data: oh?.cpu ?? null, clr: COLOR.cpu },
      { sel: '[data-gw-spark="mem"]', data: oh?.memory ?? null, clr: COLOR.memory },
      { sel: '[data-gw-spark="goroutines"]', data: gh?.goroutines ?? null, clr: COLOR.gateway },
      { sel: '[data-gw-spark="gc"]', data: gh?.gcPause ?? null, clr: COLOR.disk },
    ]
    for (const { sel, data, clr } of resSpecs) {
      const el = this.querySelector<HTMLElement>(sel)
      if (el) this._mkSpark(el, data ?? empty, clr)
    }
  }

  private _mkSpark(el: HTMLElement, data: [number[], number[]], color: string) {
    const chart = new uPlot({
      width: el.clientWidth || 100, height: 40,
      cursor: { show: false }, legend: { show: false },
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ show: false }, { show: false }],
      series: [{}, { stroke: color, width: 1.5, fill: color + '1f' }],
    }, data, el)
    this._charts.push(chart)
  }

  private _timeAxisValues(_u: uPlot, v: number[]): string[] {
    const showSec = this._range < 21600
    return v.map(t => {
      const d = new Date(t * 1000)
      return showSec
        ? d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' })
    })
  }

  private _mkChart(el: HTMLElement, data: [number[], number[]], label: string, color: string, h: number) {
    const chart = new uPlot({
      width: el.clientWidth || 300, height: h,
      cursor: { show: true, drag: { x: false, y: false } },
      legend: { show: false },
      scales: { x: { time: true }, y: { auto: true, range: (_u: uPlot, mn: number, mx: number) => [Math.min(0, mn), Math.max(mx, 1)] } },
      axes: [
        { show: true, stroke: '#555', grid: { stroke: 'rgba(128,128,128,0.06)' }, ticks: { show: false }, font: '10px sans-serif',
          values: (u: uPlot, v: number[]) => this._timeAxisValues(u, v) },
        { show: true, stroke: '#555', grid: { stroke: 'rgba(128,128,128,0.06)' }, ticks: { show: false }, font: '10px sans-serif', size: 40 },
      ],
      series: [{}, { label, stroke: color, width: 1.5, fill: color + '1f' }],
    }, data, el)
    this._charts.push(chart)
  }

}

customElements.define('page-observability-metrics', PageObservabilityMetrics)
