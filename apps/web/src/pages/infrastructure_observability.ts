// src/pages/infrastructure_observability.ts
import {
  getPrometheusScrapeHealth, fetchAdminServices,
  type PrometheusScrapeHealth, type ServicesResponse,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtTime, freshnessBadge,
  externalHost, type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

class PageInfrastructureObservability extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _prometheus: PrometheusScrapeHealth | null = null
  private _services: ServicesResponse | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Observability</h2>
          <div class="spacer"></div>
          <span id="obTimestamp" class="infra-timestamp"></span>
          <span id="obFreshness"></span>
          <button id="obRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Prometheus scrape health and monitoring service status.
        </p>
        <div id="obCards" class="infra-grid"></div>
        <div id="obTargetBar"></div>
        <div id="obLinks"></div>
      </section>
    `
    this.querySelector('#obRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    const [prR, svcR] = await Promise.allSettled([
      getPrometheusScrapeHealth(),
      fetchAdminServices(),
    ])
    this._prometheus = prR.status === 'fulfilled' ? prR.value : null
    this._services   = svcR.status === 'fulfilled' ? svcR.value : null
    this._lastUpdated = new Date()
    this.render()
  }

  private render() {
    const tsEl = this.querySelector('#obTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#obFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    this.renderCards()
    this.renderTargetBar()
    this.renderLinks()
  }

  private renderCards() {
    const el = this.querySelector('#obCards') as HTMLElement
    if (!el) return

    const p = this._prometheus
    const allSvcs = this._services?.groups?.flatMap(g => g.services) ?? []
    const monSvc = allSvcs.find(s =>
      s.name.toLowerCase().includes('monitoring') ||
      s.name.toLowerCase().includes('monitor')
    )

    // Prometheus card
    const promState: HealthState = !p ? 'unknown' : !p.connected ? 'critical' : p.downTargets > 0 ? 'degraded' : 'healthy'
    const promCard = `
      <div class="infra-card" style="border-left:4px solid ${stateColor(promState)}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Prometheus</span>
          <div style="flex:1"></div>
          ${p ? badge(p.connected ? 'CONNECTED' : 'DISCONNECTED', p.connected ? '#22c55e' : 'var(--error-color)') : badge('UNKNOWN', 'var(--secondary-text-color)')}
        </div>
        ${p ? `
          <div class="infra-card-metric">
            Active targets: <strong>${p.activeTargets}</strong><br>
            Down targets: <strong style="color:${p.downTargets > 0 ? 'var(--error-color)' : 'inherit'}">${p.downTargets}</strong><br>
            Last scrape: <strong>${p.lastScrapeAgo != null ? fmtDuration(p.lastScrapeAgo) + ' ago' : 'N/A'}</strong>
          </div>
        ` : '<div class="infra-card-metric">No data available</div>'}
      </div>
    `

    // Monitoring service card
    const monState: HealthState = monSvc ? (monSvc.derived_status as HealthState) : 'unknown'
    const monCard = monSvc ? `
      <div class="infra-card" style="border-left:4px solid ${stateColor(monState)}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">Monitoring Service</span>
          <div style="flex:1"></div>
          ${stateBadge(monState)}
        </div>
        <div class="infra-card-metric">
          ${monSvc.runtime ? `
            CPU: <strong>${monSvc.runtime.cpu_pct.toFixed(1)}%</strong>
            &middot; Mem: <strong>${fmtBytes(monSvc.runtime.memory_bytes)}</strong>
            &middot; Uptime: <strong>${fmtDuration(monSvc.runtime.uptime_sec)}</strong>
          ` : 'No runtime metrics'}
        </div>
        <div class="infra-card-sub">v${esc(monSvc.version)} &middot; port ${monSvc.port}</div>
      </div>
    ` : ''

    el.innerHTML = promCard + monCard
  }

  private renderTargetBar() {
    const el = this.querySelector('#obTargetBar') as HTMLElement
    if (!el) return
    const p = this._prometheus
    if (!p || !p.connected || p.activeTargets === 0) { el.innerHTML = ''; return }

    const upCount = p.activeTargets - p.downTargets
    const upPct = (upCount / p.activeTargets) * 100

    el.innerHTML = `
      <div class="infra-section-title">Target Health</div>
      <div class="infra-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:.85rem">
          <span style="color:#22c55e">&#9679; ${upCount} up</span>
          ${p.downTargets > 0 ? `<span style="color:var(--error-color)">&#9679; ${p.downTargets} down</span>` : ''}
        </div>
        <div class="infra-progress-bar" style="height:10px">
          <div class="infra-progress-fill" style="width:${upPct.toFixed(1)}%;background:#22c55e"></div>
        </div>
      </div>
    `
  }

  private renderLinks() {
    const el = this.querySelector('#obLinks') as HTMLElement
    if (!el) return
    const host = externalHost()
    el.innerHTML = `
      <div class="infra-quick-links">
        <a class="infra-link" href="http://${host}:9090" target="_blank" rel="noopener">Prometheus UI &rarr;</a>
        <a class="infra-link" href="http://${host}:9090/targets" target="_blank" rel="noopener">Targets &rarr;</a>
        <a class="infra-link" href="http://${host}:9090/alerts" target="_blank" rel="noopener">Alerts &rarr;</a>
        <a class="infra-link" href="#/observability/metrics">Metrics &rarr;</a>
      </div>
    `
  }
}

customElements.define('page-infrastructure-observability', PageInfrastructureObservability)
