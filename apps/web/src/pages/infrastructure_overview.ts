// src/pages/infrastructure_overview.ts
import {
  fetchAdminServices, fetchAdminStorage, fetchAdminEnvoy,
  getClusterHealth, getPrometheusScrapeHealth,
  getClusterHealthV1Full, getClusterReport,
  queryPrometheus,
  type ServicesResponse, type StorageResponse, type EnvoyResponse,
  type ClusterHealth, type PrometheusScrapeHealth,
  type ClusterHealthV1Result, type ClusterReport,
} from '@globular/backend'

import {
  INFRA_STYLES, badge, stateBadge, stateColor, esc,
  fmtBytes, fmtDuration, fmtTime, fmtRate, freshnessBadge,
  collectInfraIssues, issueRouteLabel, type InfraIssue, type HealthState,
} from '../utils/infra_health'

const POLL = 30_000

class PageInfrastructureOverview extends HTMLElement {
  private _timer: number | null = null
  private _lastUpdated: Date | null = null
  private _services: ServicesResponse | null = null
  private _storage: StorageResponse | null = null
  private _envoy: EnvoyResponse | null = null
  private _cluster: ClusterHealth | null = null
  private _prometheus: PrometheusScrapeHealth | null = null
  private _clusterV1: ClusterHealthV1Result | null = null
  private _report: ClusterReport | null = null
  private _minioReqRate: number | null = null

  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>${INFRA_STYLES}</style>
      <section class="wrap">
        <header class="infra-header">
          <h2>Infrastructure</h2>
          <div class="spacer"></div>
          <span id="ioTimestamp" class="infra-timestamp"></span>
          <span id="ioFreshness"></span>
          <button id="ioRefresh" class="infra-btn">&#8635; Refresh</button>
        </header>
        <p style="font:var(--md-typescale-body-medium);color:var(--secondary-text-color);margin:0 0 16px">
          Platform foundation health at a glance.
        </p>
        <div id="ioCards" class="infra-grid"></div>
        <div id="ioIssues"></div>
      </section>
    `
    this.querySelector('#ioRefresh')?.addEventListener('click', () => this.load())
    this.load()
    this._timer = window.setInterval(() => this.load(), POLL)
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer)
  }

  private async load() {
    const [svcR, stR, envR, clR, prR, v1R, rpR] = await Promise.allSettled([
      fetchAdminServices(),
      fetchAdminStorage(),
      fetchAdminEnvoy(),
      getClusterHealth(),
      getPrometheusScrapeHealth(),
      getClusterHealthV1Full(),
      getClusterReport(),
    ])

    this._services   = svcR.status === 'fulfilled' ? svcR.value : null
    this._storage    = stR.status  === 'fulfilled' ? stR.value  : null
    this._envoy      = envR.status === 'fulfilled' ? envR.value  : null
    this._cluster    = clR.status  === 'fulfilled' ? clR.value  : null
    this._prometheus = prR.status  === 'fulfilled' ? prR.value  : null
    this._clusterV1  = v1R.status  === 'fulfilled' ? v1R.value  : null
    this._report     = rpR.status  === 'fulfilled' ? rpR.value  : null

    // Quick MinIO request rate for storage card
    try {
      const mr = await queryPrometheus('sum(rate(minio_s3_requests_total[5m]))')
      this._minioReqRate = mr?.result?.[0] ? parseFloat(mr.result[0].value[1]) || 0 : null
    } catch { this._minioReqRate = null }

    this._lastUpdated = new Date()

    this.render()
  }

  private render() {
    const tsEl = this.querySelector('#ioTimestamp') as HTMLElement
    if (tsEl && this._lastUpdated) tsEl.textContent = `Last updated: ${fmtTime(this._lastUpdated)}`
    const freshEl = this.querySelector('#ioFreshness') as HTMLElement
    if (freshEl) freshEl.innerHTML = freshnessBadge(this._lastUpdated?.getTime() ?? null, POLL)

    this.renderCards()
    this.renderIssues()
  }

  private renderCards() {
    const el = this.querySelector('#ioCards') as HTMLElement
    if (!el) return

    const groups = [
      this.controlPlaneCard(),
      this.networkingCard(),
      this.storageCard(),
      this.observabilityCard(),
    ]

    el.innerHTML = groups.map(g => `
      <div class="infra-card infra-card-clickable" data-route="${g.route}" style="border-left: 4px solid ${stateColor(g.state)}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-weight:700;font-size:.92rem">${g.name}</span>
          <div style="flex:1"></div>
          ${stateBadge(g.state)}
        </div>
        <div class="infra-card-metric">${g.metrics}</div>
      </div>
    `).join('')

    el.querySelectorAll<HTMLElement>('[data-route]').forEach(card => {
      card.addEventListener('click', () => {
        window.location.hash = card.dataset.route!
      })
    })
  }

  private controlPlaneCard(): { name: string; state: HealthState; metrics: string; route: string } {
    const c = this._cluster
    if (!c) return { name: 'Control Plane', state: 'unknown', metrics: 'Data unavailable', route: '#/infrastructure/control-plane' }
    const state: HealthState = c.status === 'HEALTHY' ? 'healthy' : c.status === 'DEGRADED' ? 'degraded' : c.unhealthyNodes > 0 ? 'critical' : 'degraded'
    const etcd = this._services?.infra?.['etcd']
    const etcdInfo = etcd?.etcd_is_leader !== undefined ? ` &middot; etcd leader` : ''
    return {
      name: 'Control Plane',
      state,
      metrics: `${c.healthyNodes}/${c.totalNodes} nodes healthy${etcdInfo}`,
      route: '#/infrastructure/control-plane',
    }
  }

  private networkingCard(): { name: string; state: HealthState; metrics: string; route: string } {
    const e = this._envoy
    if (!e) return { name: 'Networking', state: 'unknown', metrics: 'Data unavailable', route: '#/infrastructure/networking' }
    const state: HealthState = e.healthy ? 'healthy' : 'degraded'
    const certDays = e.downstream.days_until_cert_expiry
    const certInfo = certDays > 0 ? ` &middot; cert ${Math.floor(certDays)}d` : ''
    return {
      name: 'Networking',
      state: certDays > 0 && certDays < 7 ? 'degraded' : state,
      metrics: `${esc(e.server.state)} &middot; ${e.downstream.active_conns} conns &middot; ${fmtRate(e.downstream.rps)} rps${certInfo}`,
      route: '#/infrastructure/networking',
    }
  }

  private storageCard(): { name: string; state: HealthState; metrics: string; route: string } {
    const s = this._storage
    if (!s) return { name: 'Storage', state: 'unknown', metrics: 'Data unavailable', route: '#/infrastructure/storage' }
    const state: HealthState = s.derived_status === 'healthy' ? 'healthy' : s.derived_status === 'degraded' ? 'degraded' : 'critical'
    const totalDisk = s.mounts.reduce((a, m) => a + m.total_bytes, 0)
    const usedDisk = s.mounts.reduce((a, m) => a + m.used_bytes, 0)
    const healthyApps = s.applications.filter(a => a.exists && a.writable).length
    const minioInfo = this._minioReqRate !== null ? ` &middot; MinIO ${fmtRate(this._minioReqRate)} req/s` : ''
    return {
      name: 'Storage',
      state,
      metrics: `${fmtBytes(usedDisk)} / ${fmtBytes(totalDisk)} &middot; ${healthyApps}/${s.applications.length} app paths OK${minioInfo}`,
      route: '#/infrastructure/storage',
    }
  }

  private observabilityCard(): { name: string; state: HealthState; metrics: string; route: string } {
    const p = this._prometheus
    if (!p) return { name: 'Observability', state: 'unknown', metrics: 'Data unavailable', route: '#/infrastructure/observability' }
    const state: HealthState = !p.connected ? 'critical' : p.downTargets > 0 ? 'degraded' : 'healthy'
    return {
      name: 'Observability',
      state,
      metrics: p.connected
        ? `${p.activeTargets} targets &middot; ${p.downTargets} down`
        : 'Prometheus disconnected',
      route: '#/infrastructure/observability',
    }
  }

  private renderIssues() {
    const el = this.querySelector('#ioIssues') as HTMLElement
    if (!el) return

    // Flatten services for DNS check
    const allSvcs = this._services?.groups?.flatMap(g => g.services) ?? null

    const issues = collectInfraIssues({
      clusterHealth: this._cluster,
      clusterHealthV1: this._clusterV1,
      storage: this._storage,
      envoy: this._envoy,
      prometheus: this._prometheus,
      clusterReport: this._report,
      services: allSvcs,
    })

    if (issues.length === 0) {
      el.innerHTML = `
        <div class="infra-card">
          <div class="infra-banner-ok">&#10003; No infrastructure issues detected.</div>
        </div>
      `
      return
    }

    const top = issues.slice(0, 5)
    el.innerHTML = `
      <div class="infra-card">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="infra-section-title" style="margin:0">Top Issues</span>
          <div style="flex:1"></div>
          <button class="infra-btn" id="ioCopyReport">Copy Report</button>
        </div>
        ${top.map(i => `
          <div class="infra-issue-row">
            ${badge(i.severity === 'critical' ? 'CRIT' : 'WARN', i.severity === 'critical' ? 'var(--error-color)' : '#f59e0b')}
            <span style="flex:1">${esc(i.title)}</span>
            <a class="infra-link" href="${i.route}">${issueRouteLabel(i.route)} &rarr;</a>
          </div>
        `).join('')}
      </div>
    `

    this.querySelector('#ioCopyReport')?.addEventListener('click', () => {
      this.copyReport(issues)
    })
  }

  private copyReport(issues: InfraIssue[]) {
    const lines = [
      `Infrastructure Report — ${new Date().toISOString()}`,
      `Cluster: ${this._cluster?.status ?? 'unknown'} (${this._cluster?.healthyNodes ?? '?'}/${this._cluster?.totalNodes ?? '?'} nodes healthy)`,
      `Prometheus: ${this._prometheus?.connected ? 'connected' : 'disconnected'} (${this._prometheus?.activeTargets ?? 0} targets, ${this._prometheus?.downTargets ?? 0} down)`,
      `Envoy: ${this._envoy?.healthy ? 'healthy' : 'unhealthy'} (${this._envoy?.downstream?.active_conns ?? 0} conns)`,
      `Storage: ${this._storage?.derived_status ?? 'unknown'}`,
      '',
      'Issues:',
      ...issues.map(i => `  [${i.severity.toUpperCase()}] ${i.title}`),
    ]
    navigator.clipboard.writeText(lines.join('\n'))
    const btn = this.querySelector('#ioCopyReport') as HTMLButtonElement
    if (btn) { btn.textContent = '\u2713 Copied'; setTimeout(() => btn.textContent = 'Copy Report', 1500) }
  }
}

customElements.define('page-infrastructure-overview', PageInfrastructureOverview)
