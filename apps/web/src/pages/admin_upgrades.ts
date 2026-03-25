// src/pages/admin_upgrades.ts
import {
  fetchUpgradesStatus,
  fetchUpgradePlan,
  applyUpgrades,
  fetchUpgradeJobStatus,
  fetchUpgradeHistory,
  type UpgradesStatusResponse,
  type ServiceUpgradeInfo,
  type UpgradePlanItem,
  type UpgradeJobResponse,
  type UpgradeJobRecord,
} from '@globular/sdk'

import {
  INFRA_STYLES, badge, stateColor, esc,
  fmtTime, freshnessBadge,
  type HealthState,
} from '../utils/infra_health'

const POLL = 30_000
const JOB_POLL = 2_000

// ─── Upgrade job tracking state ─────────────────────────────────────────────

type UpgradeView = 'status' | 'plan' | 'progress'

class PageAdminUpgrades extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _data: UpgradesStatusResponse | null = null
  private _loading = false
  private _error: string | null = null
  private _showUpToDate = false

  // PR2: Plan/apply/progress state
  private _view: UpgradeView = 'status'
  private _planItems: UpgradePlanItem[] = []
  private _planLoading = false
  private _planError: string | null = null
  private _applyLoading = false
  private _operationId: string | null = null
  private _job: UpgradeJobResponse | null = null
  private _jobTimer: number | null = null

  // PR3: History state
  private _history: UpgradeJobRecord[] = []
  private _showHistory = false

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}${PAGE_STYLES}</style>
      <div class="md-page-wrap">
        <div class="md-page-header">
          <h2 class="md-page-title">Upgrades</h2>
          <div style="flex:1"></div>
          <span id="upgradeTimestamp" class="upg-timestamp"></span>
          <span id="upgradeFreshness"></span>
          <button class="md-btn md-btn-text md-btn-sm" id="upgradeRefresh">&#8635; Refresh</button>
        </div>
        <p class="md-page-subtitle">
          Installed service versions and available updates from the package repository.
        </p>
        <div id="upgradeBody"></div>
      </div>
    `
    this.querySelector('#upgradeRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
    if (this._jobTimer) clearInterval(this._jobTimer)
  }

  // ─── Data ───────────────────────────────────────────────────────────────────

  private async load() {
    this._loading = true
    this.render()

    try {
      this._data = await fetchUpgradesStatus()
      this._error = null
    } catch (e: any) {
      this._error = e?.message ?? 'Failed to fetch upgrade status'
    }

    this._lastUpdated = new Date()
    this._loading = false
    this.render()

    // Load history in background (non-blocking)
    this.loadHistory()
  }

  private async loadHistory() {
    try {
      const resp = await fetchUpgradeHistory(20)
      this._history = resp.jobs
      // Re-render only if history section is visible
      if (this._showHistory && this._view === 'status') this.render()
    } catch {
      // Silent — history is best-effort
    }
  }

  private async loadPlan() {
    if (!this._data) return
    const withUpdates = this._data.services.filter(svc => svc.update_available)
    if (withUpdates.length === 0) return

    const serviceNames = withUpdates.map(svc => {
      const name = svc.name
      return name.includes('.') ? name.split('.')[0] : name
    })

    this._planLoading = true
    this._planError = null
    this._view = 'plan'
    this.render()

    try {
      const resp = await fetchUpgradePlan(serviceNames)
      this._planItems = resp.plan
    } catch (e: any) {
      this._planError = e?.message ?? 'Failed to fetch upgrade plan'
    }

    this._planLoading = false
    this.render()
  }

  private async applyPlan() {
    if (this._planItems.length === 0) return

    const services = this._planItems.map(p => p.service)
    this._applyLoading = true
    this.render()

    try {
      const resp = await applyUpgrades(services)
      if (resp.ok && resp.operation_id) {
        this._operationId = resp.operation_id
        this._view = 'progress'
        this._applyLoading = false
        this.render()
        this.startJobPoll()
      } else {
        this._planError = resp.message || 'Upgrade apply failed'
        this._applyLoading = false
        this.render()
      }
    } catch (e: any) {
      this._planError = e?.message ?? 'Failed to apply upgrades'
      this._applyLoading = false
      this.render()
    }
  }

  private startJobPoll() {
    if (this._jobTimer) clearInterval(this._jobTimer)
    this.pollJob()
    this._jobTimer = window.setInterval(() => this.pollJob(), JOB_POLL)
  }

  private async pollJob() {
    if (!this._operationId) return
    try {
      this._job = await fetchUpgradeJobStatus(this._operationId)
      this.render()

      // Stop polling when terminal
      const s = this._job.status
      if (s === 'success' || s === 'failed' || s === 'rolled_back') {
        if (this._jobTimer) {
          clearInterval(this._jobTimer)
          this._jobTimer = null
        }
        // Refresh status data after completion
        this.load()
      }
    } catch (e: any) {
      // Transient failure — keep polling
    }
  }

  private backToStatus() {
    this._view = 'status'
    this._planItems = []
    this._planError = null
    this._operationId = null
    this._job = null
    if (this._jobTimer) {
      clearInterval(this._jobTimer)
      this._jobTimer = null
    }
    this.render()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  private render() {
    const tsEl = this.querySelector('#upgradeTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#upgradeFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    const body = this.querySelector('#upgradeBody') as HTMLElement
    if (!body) return

    if (this._view === 'plan') {
      body.innerHTML = this.renderPlanView()
      this.wirePlanButtons(body)
      return
    }

    if (this._view === 'progress') {
      body.innerHTML = this.renderProgressView()
      this.wireProgressButtons(body)
      return
    }

    // Default: status view
    if (this._loading && !this._lastUpdated) {
      body.innerHTML = '<p class="md-empty">Loading upgrade status...</p>'
      return
    }

    if (this._error) {
      body.innerHTML = `
        <div class="md-banner-error">${esc(this._error)}</div>
        ${this._data ? this.renderContent() : ''}
      `
      this.wireButtons(body)
      return
    }

    if (!this._data) {
      body.innerHTML = '<p class="md-empty">No data available.</p>'
      return
    }

    body.innerHTML = this.renderContent()
    this.wireButtons(body)
  }

  private renderContent(): string {
    const d = this._data!
    const s = d.summary

    // Separate services into updates available vs up-to-date/unknown
    const withUpdates = d.services.filter(svc => svc.update_available)
    const upToDate = d.services.filter(svc => !svc.update_available && svc.latest_version)
    const unknown = d.services.filter(svc => !svc.update_available && !svc.latest_version)

    return `
      <!-- Summary cards -->
      <div class="upg-stats-grid">
        ${this.renderStatCard('Total Installed', String(s.total_installed), 'var(--accent-color)')}
        ${this.renderStatCard('Updates Available', String(s.updates_available),
          s.updates_available > 0 ? '#f59e0b' : 'var(--success-color)')}
        ${this.renderStatCard('Up to Date', String(s.up_to_date), 'var(--success-color)')}
        ${this.renderStatCard('Unknown', String(s.unknown),
          s.unknown > 0 ? 'var(--secondary-text-color)' : 'var(--success-color)')}
      </div>

      <!-- Node info -->
      <div class="upg-node-info">
        Node: <strong>${esc(d.node)}</strong> &middot; Platform: <strong>${esc(d.platform)}</strong>
      </div>

      ${s.updates_available > 0 ? `
        <!-- Available updates -->
        <div class="md-panel">
          <div class="md-panel-header">
            <span>Available Updates (${s.updates_available})</span>
            <button class="md-btn md-btn-filled md-btn-sm" id="btnReviewUpgrades">
              Review &amp; Upgrade
            </button>
          </div>
          ${this.renderServiceTable(withUpdates, true)}
        </div>
      ` : d.repository_status === 'empty' ? '' : `
        <div class="upg-banner-ok">All services are up to date.</div>
      `}

      ${upToDate.length > 0 ? `
        <div class="upg-toggle-row">
          <button class="md-btn md-btn-text md-btn-sm" id="toggleUpToDate">
            ${this._showUpToDate ? 'Hide' : 'Show'} up-to-date services (${upToDate.length})
          </button>
        </div>
        ${this._showUpToDate ? `
          <div class="md-panel">
            <div class="md-panel-header">
              <span>Up to Date (${upToDate.length})</span>
            </div>
            ${this.renderServiceTable(upToDate, false)}
          </div>
        ` : ''}
      ` : ''}

      ${unknown.length > 0 ? `
        ${d.repository_status === 'empty'
          ? '<div class="md-banner-warn">No packages have been published to the repository yet. Use <code>globular pkg publish</code> to publish service packages.</div>'
          : d.repository_status === 'unreachable'
            ? '<div class="md-banner-error">Repository service is unreachable. Check that the repository service is running.</div>'
            : ''}
        <div class="md-panel">
          <div class="md-panel-header">
            <span>Unknown (${unknown.length})</span>
          </div>
          ${this.renderServiceTable(unknown, false)}
        </div>
      ` : ''}

      <!-- Upgrade history -->
      <div class="upg-toggle-row" style="border-top:1px solid var(--border-subtle-color);padding-top:16px">
        <button class="md-btn md-btn-text md-btn-sm" id="toggleHistory">
          ${this._showHistory ? 'Hide' : 'Show'} upgrade history${this._history.length > 0 ? ` (${this._history.length})` : ''}
        </button>
      </div>
      ${this._showHistory ? this.renderHistory() : ''}
    `
  }

  private renderHistory(): string {
    if (this._history.length === 0) {
      return '<p class="md-empty" style="margin-top:12px">No upgrade history yet.</p>'
    }

    let html = `
      <div class="md-panel" style="margin-top:12px">
        <div class="md-panel-header"><span>Upgrade History</span></div>
        <table class="md-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Services</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
    `

    for (const job of this._history) {
      const date = new Date(job.started_at)
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

      const statusColor = job.status === 'success' ? 'var(--success-color)'
        : job.status === 'failed' || job.status === 'rolled_back' ? 'var(--error-color)'
        : job.status === 'running' ? '#3b82f6'
        : '#f59e0b'

      const svcList = job.services.map(s =>
        `<span class="upg-hist-svc">${esc(s.name)} <code>${esc(s.from || '?')}${s.from_build_number ? '+b' + s.from_build_number : ''}</code> &rarr; <code>${esc(s.to)}${s.to_build_number ? '+b' + s.to_build_number : ''}</code></span>`
      ).join(', ')

      let duration = '—'
      if (job.finished_at > 0) {
        const ms = job.finished_at - job.started_at
        if (ms < 1000) duration = `${ms}ms`
        else if (ms < 60_000) duration = `${(ms / 1000).toFixed(1)}s`
        else duration = `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
      } else if (job.status === 'running') {
        duration = 'in progress...'
      }

      html += `
        <tr>
          <td style="white-space:nowrap">${dateStr}</td>
          <td>${svcList}</td>
          <td>${badge(job.status.replace(/_/g, ' ').toUpperCase(), statusColor)}</td>
          <td style="white-space:nowrap">${duration}</td>
          <td>${job.error ? `<span style="color:var(--error-color);font-size:.72rem">${esc(job.error)}</span>` : '—'}</td>
        </tr>
      `
    }

    html += '</tbody></table></div>'
    return html
  }

  private renderStatCard(label: string, value: string, color: string): string {
    return `
      <div class="md-stat-card" style="border-left:3px solid ${color}">
        <div class="md-stat-label">${label}</div>
        <div class="md-stat-value" style="color:${color}">${value}</div>
      </div>
    `
  }

  private renderServiceTable(services: ServiceUpgradeInfo[], showAction: boolean): string {
    // Group by category
    const byCategory = new Map<string, ServiceUpgradeInfo[]>()
    for (const svc of services) {
      const cat = svc.category || 'Other'
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(svc)
    }

    const categoryOrder = ['Core', 'Infrastructure', 'Media', 'Other']
    const sortedCategories = [...byCategory.keys()].sort(
      (a, b) => (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a))
            - (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b))
    )

    let html = `<table class="md-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Category</th>
          <th>Installed</th>
          <th>Latest</th>
          <th>Status</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>`

    for (const cat of sortedCategories) {
      const svcs = byCategory.get(cat)!
      for (const svc of svcs) {
        const statusBadge = svc.update_available
          ? badge('UPDATE', '#f59e0b')
          : svc.latest_version
            ? badge('OK', 'var(--success-color)')
            : badge('UNKNOWN', 'var(--secondary-text-color)')

        const derived = (svc.derived_status || 'unknown') as HealthState
        const stateClr = stateColor(derived)

        const displayName = svc.display_name || svc.name
        // Strip the long "service.ServiceName" format for display
        const shortName = displayName.includes('.') ? displayName.split('.')[0] : displayName

        html += `
          <tr${svc.update_available ? ' class="upg-row-update"' : ''}>
            <td>
              <span style="font-weight:600">${esc(shortName)}</span>
              ${shortName !== displayName ? `<br><span class="upg-svc-id">${esc(displayName)}</span>` : ''}
            </td>
            <td>${badge(cat, catColor(cat))}</td>
            <td><code class="upg-code">${esc(svc.installed_version || '—')}${svc.installed_build_number ? '+b' + svc.installed_build_number : ''}</code></td>
            <td><code class="upg-code">${esc(svc.latest_version || '—')}${svc.latest_build_number ? '+b' + svc.latest_build_number : ''}</code></td>
            <td>${statusBadge}</td>
            <td><span style="color:${stateClr}">${esc(svc.state || 'unknown')}</span></td>
          </tr>`
      }
    }

    html += '</tbody></table>'
    return html
  }

  // ─── Plan view ────────────────────────────────────────────────────────────

  private renderPlanView(): string {
    let content = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <button class="md-btn md-btn-text md-btn-sm" id="btnBackToStatus">&larr; Back</button>
        <h3 style="margin:0;font:var(--md-typescale-title-small)">Upgrade Plan Preview</h3>
      </div>
    `

    if (this._planLoading) {
      content += '<p class="md-empty">Generating upgrade plan...</p>'
      return content
    }

    if (this._planError) {
      content += `<div class="md-banner-error">${esc(this._planError)}</div>`
    }

    if (this._planItems.length === 0 && !this._planError) {
      content += '<div class="upg-banner-ok">All selected services are already up to date.</div>'
      return content
    }

    if (this._planItems.length > 0) {
      content += `
        <p class="md-page-subtitle" style="margin-top:0">
          The following services will be upgraded. Each service will be restarted after installation.
        </p>
        <div class="md-panel">
          <div class="md-panel-header"><span>Plan (${this._planItems.length} services)</span></div>
          <table class="md-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Current</th>
                <th></th>
                <th>New Version</th>
                <th>Impacts</th>
              </tr>
            </thead>
            <tbody>
      `

      for (const item of this._planItems) {
        const impacts = (item.impacts || []).map(i => `<span class="upg-impact-tag">${esc(i)}</span>`).join(' ')
        content += `
          <tr>
            <td><span style="font-weight:600">${esc(item.service)}</span></td>
            <td><code class="upg-code">${esc(item.from || '—')}${item.from_build_number ? '+b' + item.from_build_number : ''}</code></td>
            <td style="text-align:center;color:var(--secondary-text-color)">&rarr;</td>
            <td><code class="upg-code" style="color:var(--success-color);font-weight:600">${esc(item.to)}${item.to_build_number ? '+b' + item.to_build_number : ''}</code></td>
            <td>${impacts || '<span style="color:var(--secondary-text-color)">—</span>'}</td>
          </tr>
        `
      }

      content += `</tbody></table></div>`

      // Apply button with confirmation
      content += `
        <div class="upg-apply-bar">
          <div class="upg-apply-warning">
            This will download packages, install files, and restart ${this._planItems.length} service(s).
            Affected services will be briefly unavailable.
          </div>
          <button class="md-btn md-btn-danger md-btn-sm" id="btnApplyUpgrades" ${this._applyLoading ? 'disabled' : ''}>
            ${this._applyLoading ? 'Applying...' : `Apply ${this._planItems.length} Upgrade(s)`}
          </button>
        </div>
      `
    }

    return content
  }

  // ─── Progress view ────────────────────────────────────────────────────────

  private renderProgressView(): string {
    const job = this._job

    let content = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <h3 style="margin:0;font:var(--md-typescale-title-small)">Upgrade in Progress</h3>
      </div>
    `

    if (!job) {
      content += '<p class="md-empty">Waiting for job status...</p>'
      return content
    }

    // Status badge
    const statusColor = job.status === 'success' ? 'var(--success-color)'
      : job.status === 'failed' || job.status === 'rolled_back' ? 'var(--error-color)'
      : job.status === 'running' ? '#3b82f6'
      : '#f59e0b'
    const statusLabel = job.status.replace(/_/g, ' ').toUpperCase()

    content += `
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
        ${badge(statusLabel, statusColor)}
        <div class="upg-progress-bar-wrap">
          <div class="upg-progress-bar" style="width:${job.progress}%"></div>
        </div>
        <span style="font-size:.78rem;font-weight:600;min-width:40px">${job.progress}%</span>
      </div>
    `

    if (job.error) {
      content += `<div class="md-banner-error">${esc(job.error)}</div>`
    }

    // Steps list
    if (job.steps && job.steps.length > 0) {
      content += '<div class="md-panel"><div class="upg-steps">'
      for (const step of job.steps) {
        const icon = step.state === 'ok' ? '&#10003;'
          : step.state === 'failed' ? '&#10007;'
          : step.state === 'running' ? '&#9679;'
          : step.state === 'skipped' ? '&#8212;'
          : '&#9675;'
        const stepColor = step.state === 'ok' ? 'var(--success-color)'
          : step.state === 'failed' ? 'var(--error-color)'
          : step.state === 'running' ? '#3b82f6'
          : 'var(--secondary-text-color)'
        content += `
          <div class="upg-step ${step.state === 'running' ? 'upg-step--active' : ''}">
            <span class="upg-step-icon" style="color:${stepColor}">${icon}</span>
            <span class="upg-step-id">${esc(step.id)}</span>
            <span class="upg-step-state" style="color:${stepColor}">${esc(step.state)}</span>
            ${step.message ? `<span class="upg-step-msg">${esc(step.message)}</span>` : ''}
          </div>
        `
      }
      content += '</div></div>'
    }

    // Back button when terminal
    const terminal = job.status === 'success' || job.status === 'failed' || job.status === 'rolled_back'
    if (terminal) {
      content += `
        <div style="margin-top:20px">
          <button class="md-btn md-btn-text md-btn-sm" id="btnBackToStatus">&larr; Back to Status</button>
        </div>
      `
    }

    return content
  }

  // ─── Wire buttons ─────────────────────────────────────────────────────────

  private wireButtons(body: HTMLElement) {
    body.querySelector('#toggleUpToDate')?.addEventListener('click', () => {
      this._showUpToDate = !this._showUpToDate
      this.render()
    })
    body.querySelector('#btnReviewUpgrades')?.addEventListener('click', () => {
      this.loadPlan()
    })
    body.querySelector('#toggleHistory')?.addEventListener('click', () => {
      this._showHistory = !this._showHistory
      if (this._showHistory && this._history.length === 0) this.loadHistory()
      this.render()
    })
  }

  private wirePlanButtons(body: HTMLElement) {
    body.querySelector('#btnBackToStatus')?.addEventListener('click', () => {
      this.backToStatus()
    })
    body.querySelector('#btnApplyUpgrades')?.addEventListener('click', () => {
      this.applyPlan()
    })
  }

  private wireProgressButtons(body: HTMLElement) {
    body.querySelector('#btnBackToStatus')?.addEventListener('click', () => {
      this.backToStatus()
    })
  }
}

function catColor(cat: string): string {
  switch (cat) {
    case 'Core': return '#8b6fc0'
    case 'Infrastructure': return '#3b82f6'
    case 'Media': return '#a78bfa'
    default: return 'var(--secondary-text-color)'
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────
// Only page-specific styles that are not covered by the shared design system.

const PAGE_STYLES = `
.upg-timestamp {
  font: var(--md-typescale-label-small);
  color: var(--secondary-text-color);
}
.upg-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}
.upg-node-info {
  font-size: .72rem;
  color: var(--secondary-text-color);
  margin-bottom: 16px;
}
.upg-svc-id {
  font-size: .68rem;
  color: var(--secondary-text-color);
}
.upg-code {
  font-family: monospace;
  font-size: .75rem;
}
.upg-row-update {
  background: color-mix(in srgb, #f59e0b 6%, var(--surface-color, #fff));
}
.upg-toggle-row {
  margin: 16px 0;
}
.upg-banner-ok {
  padding: 10px 14px;
  border-radius: var(--md-shape-sm);
  font-size: .82rem;
  margin-bottom: 16px;
  background: color-mix(in srgb, var(--success-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--success-color) 30%, transparent);
  color: var(--success-color);
}
.upg-impact-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--md-shape-full);
  font-size: .68rem;
  background: color-mix(in srgb, #f59e0b 12%, transparent);
  color: var(--on-surface-color);
  margin: 1px 2px;
}
.upg-apply-bar {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--md-shape-sm);
  background: color-mix(in srgb, var(--error-color) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--error-color) 20%, transparent);
  display: flex;
  align-items: center;
  gap: 16px;
}
.upg-apply-warning {
  flex: 1;
  font-size: .75rem;
  color: var(--secondary-text-color);
}
.upg-progress-bar-wrap {
  flex: 1;
  height: 6px;
  background: color-mix(in srgb, var(--on-surface-color) 10%, transparent);
  border-radius: 3px;
  overflow: hidden;
}
.upg-progress-bar {
  height: 100%;
  background: #3b82f6;
  border-radius: 3px;
  transition: width .3s ease;
}
.upg-steps {
  display: flex;
  flex-direction: column;
}
.upg-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  font-size: .75rem;
  border-bottom: 1px solid var(--border-subtle-color);
}
.upg-step:last-child { border-bottom: none; }
.upg-step--active {
  background: color-mix(in srgb, #3b82f6 8%, transparent);
}
.upg-step-icon {
  font-size: .9rem;
  width: 18px;
  text-align: center;
}
.upg-step-id {
  font-family: monospace;
  font-size: .72rem;
  min-width: 160px;
}
.upg-step-state {
  font-size: .68rem;
  font-weight: 700;
  text-transform: uppercase;
  min-width: 60px;
}
.upg-step-msg {
  font-size: .68rem;
  color: var(--secondary-text-color);
}
.upg-hist-svc {
  font-size: .72rem;
}
.upg-hist-svc code {
  font-family: monospace;
  font-size: .68rem;
}
`

customElements.define('page-admin-upgrades', PageAdminUpgrades)
