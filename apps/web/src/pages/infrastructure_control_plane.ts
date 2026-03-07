// src/pages/infrastructure_control_plane.ts
import {
  fetchAdminServices, getClusterHealth, getClusterHealthV1Full,
  getClusterReport, fetchAdminServiceLogs,
  type ServicesResponse, type ClusterHealth,
  type ClusterHealthV1Result, type ClusterReport,
  type ServiceLogsResponse,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

const LOG_UNITS = [
  { value: 'globular-etcd.service',                 label: 'etcd' },
  { value: 'etcd.service',                          label: 'etcd (alt)' },
  { value: 'globular-cluster-controller.service',   label: 'Cluster Controller' },
  { value: 'globular-node-agent.service',           label: 'Node Agent' },
  { value: 'globular-xds.service',                  label: 'xDS' },
  { value: 'globular-envoy.service',                 label: 'Envoy' },
]

const LOG_STYLES = `
  .log-controls {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .log-controls select, .log-controls button {
    font-size: .78rem; padding: 3px 8px;
    border: 1px solid var(--border-subtle-color);
    border-radius: var(--md-shape-sm);
    background: var(--surface-color, #1e1e1e); color: var(--on-surface-color);
    cursor: pointer;
  }
  .log-controls select option {
    background: var(--surface-color, #1e1e1e); color: var(--on-surface-color);
  }
  .log-controls select:hover, .log-controls button:hover {
    background: var(--md-state-hover);
  }
  .log-block {
    font-family: monospace; font-size: 12px;
    max-height: 320px; overflow: auto;
    background: var(--md-surface-container);
    padding: 12px; border-radius: 8px;
    white-space: pre-wrap; word-break: break-all;
    line-height: 1.5;
  }
  .log-line-error { color: var(--error-color); }
  .log-line-warn { color: #f59e0b; }
`

class PageInfrastructureControlPlane extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _services: ServicesResponse | null = null
  private _cluster: ClusterHealth | null = null
  private _clusterV1: ClusterHealthV1Result | null = null
  private _report: ClusterReport | null = null
  private _logs: ServiceLogsResponse | null = null
  private _logsLoading = false

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}${LOG_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Control Plane</h2>
          <div class="spacer"></div>
          <span id="cpTimestamp" class="infra-timestamp"></span>
          <span id="cpFreshness"></span>
          <button id="cpRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Cluster controller, etcd health, node agents, and diagnostics summary.
        </p>
        <div id="cpSummary" class="infra-grid"></div>
        <div id="cpComponents" class="infra-grid"></div>
        <div id="cpNodes"></div>
        <div id="cpLogs"></div>
        <div id="cpLinks"></div>
      </section>
    `
    this.querySelector('#cpRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    const [svcR, clR, v1R, rpR] = await Promise.allSettled([
      fetchAdminServices(),
      getClusterHealth(),
      getClusterHealthV1Full(),
      getClusterReport(),
    ])

    this._services  = svcR.status === 'fulfilled' ? svcR.value : null
    this._cluster   = clR.status  === 'fulfilled' ? clR.value  : null
    this._clusterV1 = v1R.status  === 'fulfilled' ? v1R.value  : null
    this._report    = rpR.status  === 'fulfilled' ? rpR.value  : null
    this._lastUpdated = new Date()
    this.render()
  }

  private render() {
    const tsEl = this.querySelector('#cpTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#cpFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    this.renderSummary()
    this.renderComponents()
    this.renderNodes()
    this.renderLogsPanel()
    this.renderLinks()
  }

  private renderSummary() {
    const el = this.querySelector('#cpSummary') as HTMLElement
    if (!el) return
    const c = this._cluster
    if (!c) { el.innerHTML = `<div class="infra-empty">Control plane data unavailable.</div>`; return }

    const clusterState: HealthState = c.status === 'HEALTHY' ? 'healthy' : c.status === 'DEGRADED' ? 'degraded' : 'critical'
    const r = this._report
    const critFindings = r ? r.findings.filter(f => f.severity >= 4).length : 0
    const warnFindings = r ? r.findings.filter(f => f.severity >= 2 && f.severity < 4).length : 0

    el.innerHTML = `
      <div class="infra-card" style="border-left:4px solid ${stateColor(clusterState)}">
        <div class="infra-card-label">Cluster Status</div>
        <div style="margin:6px 0">${stateBadge(clusterState)}</div>
        <div class="infra-card-sub">${c.healthyNodes}/${c.totalNodes} nodes healthy</div>
        ${c.clusterDomain ? `<div class="infra-card-sub">Domain: ${esc(c.clusterDomain)}</div>` : ''}
      </div>
      <div class="infra-card">
        <div class="infra-card-label">Node Health</div>
        <div class="infra-card-value" style="color:${c.unhealthyNodes > 0 ? 'var(--error-color)' : '#22c55e'}">${c.healthyNodes}/${c.totalNodes}</div>
        <div class="infra-card-sub">
          ${c.unhealthyNodes > 0 ? `<span style="color:var(--error-color)">${c.unhealthyNodes} unhealthy</span>` : ''}
          ${c.unknownNodes > 0 ? `<span style="color:var(--secondary-text-color)">${c.unknownNodes} unknown</span>` : ''}
          ${c.unhealthyNodes === 0 && c.unknownNodes === 0 ? 'All healthy' : ''}
        </div>
      </div>
      <div class="infra-card">
        <div class="infra-card-label">Diagnostics Findings</div>
        <div style="font-size:.85rem;line-height:1.7;margin-top:4px">
          ${critFindings > 0 ? `<span style="color:var(--error-color);font-weight:700">${critFindings} Critical</span><br>` : ''}
          ${warnFindings > 0 ? `<span style="color:#f59e0b">${warnFindings} Warning</span><br>` : ''}
          ${!r ? '<span style="color:var(--secondary-text-color)">Unavailable</span>' : (critFindings + warnFindings === 0 ? '<span style="color:#22c55e">No issues</span>' : '')}
        </div>
      </div>
    `
  }

  private renderComponents() {
    const el = this.querySelector('#cpComponents') as HTMLElement
    if (!el) return
    const infra = this._services?.infra ?? {}
    const allSvcs = this._services?.groups?.flatMap(g => g.services) ?? []

    // etcd
    const etcd = infra['etcd']
    const etcdSvc = allSvcs.find(s => s.name.toLowerCase().includes('etcd'))

    // Cluster controller
    const ccSvc = allSvcs.find(s =>
      s.name.toLowerCase().includes('cluster_controller') ||
      s.name.toLowerCase().includes('clustercontroller')
    )

    el.innerHTML = `
      ${etcd || etcdSvc ? `
        <div class="infra-card" style="border-left:4px solid ${stateColor(etcdSvc?.derived_status === 'healthy' ? 'healthy' : etcdSvc?.derived_status === 'degraded' ? 'degraded' : etcd ? 'healthy' : 'unknown')}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-weight:700;font-size:.88rem">etcd</span>
            <div style="flex:1"></div>
            ${etcdSvc ? stateBadge(etcdSvc.derived_status as HealthState) : ''}
          </div>
          <div class="infra-card-metric">
            ${etcd ? `
              Leader: <strong>${etcd.etcd_is_leader ? 'Yes' : 'No'}</strong><br>
              DB Size: <strong>${fmtBytes(etcd.etcd_db_size_bytes ?? 0)}</strong><br>
              Total Keys: <strong>${(etcd.etcd_total_keys ?? 0).toLocaleString()}</strong>
            ` : 'No infra metrics available'}
          </div>
          ${etcdSvc ? `<div class="infra-card-sub">v${esc(etcdSvc.version)} &middot; port ${etcdSvc.port}</div>` : ''}
        </div>
      ` : ''}

      ${ccSvc ? `
        <div class="infra-card" style="border-left:4px solid ${stateColor(ccSvc.derived_status as HealthState)}">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-weight:700;font-size:.88rem">Cluster Controller</span>
            <div style="flex:1"></div>
            ${stateBadge(ccSvc.derived_status as HealthState)}
          </div>
          <div class="infra-card-metric">
            ${ccSvc.runtime ? `
              CPU: <strong>${ccSvc.runtime.cpu_pct.toFixed(1)}%</strong>
              &middot; Mem: <strong>${fmtBytes(ccSvc.runtime.memory_bytes)}</strong>
              &middot; Uptime: <strong>${fmtDuration(ccSvc.runtime.uptime_sec)}</strong>
            ` : 'No runtime metrics'}
          </div>
          <div class="infra-card-sub">v${esc(ccSvc.version)} &middot; port ${ccSvc.port}</div>
        </div>
      ` : ''}
    `
  }

  private renderNodes() {
    const el = this.querySelector('#cpNodes') as HTMLElement
    if (!el) return
    const c = this._cluster
    if (!c) { el.innerHTML = ''; return }

    const color = c.unhealthyNodes > 0 ? 'var(--error-color)' : '#22c55e'
    el.innerHTML = `
      <div class="infra-card" style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="font-size:.85rem">
          Nodes healthy: <strong style="color:${color}">${c.healthyNodes}/${c.totalNodes}</strong>
        </span>
        <div style="flex:1"></div>
        <a class="infra-link" href="#/cluster/nodes">Manage Nodes &rarr;</a>
      </div>
    `
  }

  // ─── Recent Logs panel (manual refresh only) ──────────────────────────────

  private renderLogsPanel() {
    const el = this.querySelector('#cpLogs') as HTMLElement
    if (!el) return

    // Only render the shell once; subsequent calls update the log output
    if (!el.querySelector('#logUnit')) {
      el.innerHTML = `
        <div class="infra-section-title" style="margin-top:20px">Recent Logs</div>
        <div class="infra-card">
          <div class="log-controls">
            <select id="logUnit">
              ${LOG_UNITS.map((u, i) => `<option value="${esc(u.value)}"${i === 0 ? ' selected' : ''}>${esc(u.label)}</option>`).join('')}
            </select>
            <select id="logLines">
              <option value="50">50 lines</option>
              <option value="100" selected>100 lines</option>
              <option value="200">200 lines</option>
            </select>
            <button id="logFetch" class="infra-btn">&#9654; Fetch Logs</button>
            <span id="logStatus" style="font-size:.75rem;color:var(--secondary-text-color)"></span>
          </div>
          <div id="logOutput"></div>
        </div>
      `
      this.querySelector('#logFetch')?.addEventListener('click', () => this.fetchLogs())
    }

    // If logs were already fetched, re-render them
    if (this._logs || this._logsLoading) this.renderLogOutput()
  }

  private async fetchLogs() {
    const unitEl = this.querySelector('#logUnit') as HTMLSelectElement
    const linesEl = this.querySelector('#logLines') as HTMLSelectElement
    if (!unitEl || !linesEl) return

    const unit = unitEl.value
    const lines = parseInt(linesEl.value, 10) || 100

    this._logsLoading = true
    this._logs = null
    this.renderLogOutput()

    try {
      this._logs = await fetchAdminServiceLogs(unit, lines, 86400)
    } catch (e: any) {
      this._logs = { unit, lines: null, truncated: false, timestamp: Date.now(), error: e?.message || 'Fetch failed' }
    }
    this._logsLoading = false
    this.renderLogOutput()
  }

  private renderLogOutput() {
    const el = this.querySelector('#logOutput') as HTMLElement
    const statusEl = this.querySelector('#logStatus') as HTMLElement
    if (!el) return

    if (this._logsLoading) {
      el.innerHTML = `<div style="padding:12px;font-size:.82rem;color:var(--secondary-text-color)">Fetching logs&hellip;</div>`
      if (statusEl) statusEl.textContent = ''
      return
    }

    const logs = this._logs
    if (!logs) {
      el.innerHTML = `<div style="padding:12px;font-size:.82rem;color:var(--secondary-text-color)">Select a unit and click Fetch Logs.</div>`
      return
    }

    if (logs.error && (!logs.lines || logs.lines.length === 0)) {
      el.innerHTML = `<div style="padding:12px;font-size:.82rem;color:var(--error-color)">${esc(logs.error)}</div>`
      if (statusEl) statusEl.textContent = ''
      return
    }

    const lines = logs.lines ?? []
    if (statusEl) {
      const parts = [`${lines.length} line(s)`]
      if (logs.truncated) parts.push('(truncated)')
      if (logs.error) parts.push(`\u26A0 ${logs.error}`)
      statusEl.textContent = parts.join(' ')
    }

    // Render with lightweight highlighting
    const highlighted = lines.map(line => {
      const lower = line.toLowerCase()
      if (/\b(error|fatal|panic|segfault|critical)\b/.test(lower)) {
        return `<span class="log-line-error">${esc(line)}</span>`
      }
      if (/\b(warn|warning)\b/.test(lower)) {
        return `<span class="log-line-warn">${esc(line)}</span>`
      }
      return esc(line)
    })

    el.innerHTML = `<pre class="log-block">${highlighted.join('\n')}</pre>`
  }

  private renderLinks() {
    const el = this.querySelector('#cpLinks') as HTMLElement
    if (!el) return
    el.innerHTML = `
      <div class="infra-quick-links">
        <a class="infra-link" href="#/admin/diagnostics">Diagnostics &rarr;</a>
        <a class="infra-link" href="#/cluster/reconciliation">Reconciliation &rarr;</a>
        <a class="infra-link" href="#/cluster/nodes">Nodes &rarr;</a>
      </div>
    `
  }
}

customElements.define('page-infrastructure-control-plane', PageInfrastructureControlPlane)
